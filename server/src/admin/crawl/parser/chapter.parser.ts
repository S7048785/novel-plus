import { evalFieldOnDoc, extractListFromHtml, extractListFromJson, type EvalContext } from './rule-engine.js';
import { htmlToMarkdown } from './content-cleaner.js';
import { resolveUrl } from '../crawler/url.js';
import type { HttpClient } from '../crawler/http-client.js';

import type { BookSource } from '../../../common/model/book-source.js';
import { isJsonContent, sourceHeaders } from '../crawler/source-request.js';

/**
 * 目录与正文的抓取解析。
 *
 * 与 book-info.parser 的区别：这两处都可能**多页**（目录有 nextTocUrl、正文有 nextContentUrl），
 * 所以除了规则引擎，还需要 HttpClient 来抓后续页——http 作为参数传入，模块本身不持有状态。
 */

/** 目录里的一章。index 由调用方保证最终连续（去重后重排）。 */
export interface ParsedChapter {
  title: string;
  url: string;
  index: number;
}

/**
 * 解析章节目录，支持多页（ruleToc.nextTocUrl 指向「下一页」链接）。
 *
 * 流程：抓当前目录页 → 提取章节 → 若有 nextTocUrl 则解析出下一页地址继续，直到没有下一页。
 * 多页合并后统一按 URL 去重，避免「最新章节区」与「正文卷区」的重复条目。
 */
export async function parseChapterList(
  source: BookSource,
  html: string,
  tocUrl: string,
  charset: string,
  http: HttpClient,
): Promise<ParsedChapter[]> {
  const rule = source.ruleToc ?? {};
  const listRule = rule.chapterList ?? '';
  if (!listRule) return [];

  const allRecords: Record<string, string>[] = [];
  let currentUrl = tocUrl;
  let currentHtml = html;
  const headers = sourceHeaders(source);
  const MAX_PAGES = 50; // 防死循环：目录最多 50 页（5 万章，远超任何现实书籍）
  const visited = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    if (visited.has(currentUrl)) break;
    visited.add(currentUrl);

    const isJson = isJsonContent(currentHtml);
    const records = isJson
      ? await extractListFromJson(listRule, { title: rule.chapterName, url: rule.chapterUrl }, currentHtml, currentUrl)
      : await extractListFromHtml(listRule, { title: rule.chapterName, url: rule.chapterUrl }, currentHtml, currentUrl);
    allRecords.push(...records);

    // 解析下一页
    if (!rule.nextTocUrl) break;
    const ctx: EvalContext = { baseUrl: currentUrl, variables: new Map() };
    const nextRaw = await evalFieldOnDoc(rule.nextTocUrl, currentHtml, ctx);
    if (!nextRaw) break;
    const nextUrl = resolveUrl(currentUrl, nextRaw);
    if (!nextUrl || nextUrl === currentUrl) break;

    const nextHtml = await http.get(nextUrl, charset, headers);
    if (!nextHtml) break;
    currentUrl = nextUrl;
    currentHtml = nextHtml;
  }

  const mapped = allRecords
    .map((r, i) => ({
      title: r.title ?? `第${i + 1}章`,
      url: resolveUrl(tocUrl, r.url ?? ''),
      index: i,
    }))
    .filter((c) => c.url);

  const deduped = dedupeChaptersByUrl(mapped);
  return deduped.map((chapter, i) => ({ ...chapter, index: i }));
}

/**
 * 抓取单章正文，支持多页拼接（nextContentUrl）。
 * 流程：抓当前页 → 提取正文 → 若有 nextContentUrl 则抓下一页拼接，直到无下一页或达到上限。
 */
export async function parseChapterContent(
  source: BookSource,
  chapterUrl: string,
  chapterTitle = '',
  charset = 'utf-8',
  http: HttpClient,
): Promise<string | null> {
  const rule = source.ruleContent ?? {};
  const { applyLegadoRegex } = await import('../parser/regex.js');

  const parts: string[] = [];
  let currentUrl = chapterUrl;
  const headers = sourceHeaders(source);
  const MAX_PAGES = 20; // 防死循环：最多抓 20 页
  const visited = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    if (visited.has(currentUrl)) break; // 防环
    visited.add(currentUrl);

    const html = await http.get(currentUrl, charset, headers);
    if (!html) break;

    let processed = html;
    if (rule.sourceRegex) {
      processed = applyLegadoRegex(processed, rule.sourceRegex);
    }

    const ctx: EvalContext = { baseUrl: currentUrl, variables: new Map() };
    let content = (await evalFieldOnDoc(rule.content, processed, ctx)) ?? '';
    if (content && rule.replaceRegex) {
      content = applyLegadoRegex(content, rule.replaceRegex);
    }
    if (content) parts.push(content);

    // 提取下一页 URL
    if (!rule.nextContentUrl) break;
    const nextRaw = await evalFieldOnDoc(rule.nextContentUrl, processed, ctx);
    if (!nextRaw) break;
    const nextUrl = resolveUrl(currentUrl, nextRaw);
    if (!nextUrl || nextUrl === currentUrl) break;
    currentUrl = nextUrl;
  }

  // 入库前统一清洗成 Markdown（一段一行、段间空行）。
  // 多页正文先按 \n 拼起来再整体清洗，保证跨页的段落边界也能正确归一。
  const markdown = parts.length > 0 ? htmlToMarkdown(parts.join('\n')) : null;
  // 兜底：纯文本路径无法识别标题标签，若清洗后首段与章节标题重复则剥掉。
  // （HTML 路径的标题由 content-cleaner 丢弃 <h1>~<h6> 标签处理，这里再挡一道。）
  return stripLeadingTitle(markdown, chapterTitle);
}

/**
 * 若正文首段与章节标题一致（忽略首尾空白），剥掉该首段。
 * 章节标题已单独存 book_chapter.title，正文里不应重复出现。
 */
function stripLeadingTitle(markdown: string | null, title: string): string | null {
  if (!markdown || !title) return markdown;
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return markdown;
  const firstSep = markdown.indexOf('\n\n');
  const firstPara = firstSep === -1 ? markdown : markdown.slice(0, firstSep);
  if (firstPara.trim() === normalizedTitle) {
    const rest = firstSep === -1 ? '' : markdown.slice(firstSep + 2);
    return rest.trim() || null;
  }
  return markdown;
}

/**
 * 按 URL 去重，保留最后一次出现的位置。
 *
 * 目录页常见形态是「最新章节 N 条（倒序）+ 完整目录（正序）」，前半段与后半段尾部重复。
 * 从后往前扫、保留后出现的，正好剩下「完整且正序」的那份；反过来扫会得到错序目录。
 */
export function dedupeChaptersByUrl<T extends { url: string }>(chapters: T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (let i = chapters.length - 1; i >= 0; i -= 1) {
    const chapter = chapters[i];
    if (seen.has(chapter.url)) continue;
    seen.add(chapter.url);
    kept.unshift(chapter);
  }
  return kept;
}
