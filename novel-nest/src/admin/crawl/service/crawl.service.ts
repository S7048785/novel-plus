import { BadGatewayException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import iconv from 'iconv-lite';
import { HttpClient, parseUrlOptions } from '../crawler/http-client.js';
import { resolveUrl } from '../crawler/url.js';
import { evalFieldOnDoc, extractListFromHtml, extractListFromJson, type EvalContext } from '../parser/rule-engine.js';
import { evalJs } from '../parser/js.js';
import { stripModePrefix } from '../parser/mode.js';
import { CrawlSourceRepository } from '../../../common/repo/crawl-source.repo.js';
import { BookRepository } from '../../../common/repo/book.repo.js';
import { BookChapterRepository } from '../../../common/repo/book-chapter.repo.js';
import type { BookSource, SearchRule } from '../../../common/model/book-source.js';

/**
 * 采集编排服务（复刻 reader-rust 的 search_books / get_book_info / get_chapter_list / get_chapter_content）
 *
 * 只做编排：抓取 → 解析 → 调 repo 落库。所有 DB 操作下沉到 repo 层。
 */

export interface SearchResult {
  name: string;
  /** 作者可缺失，缺失时为 null（与 book.author 可空一致，不回落成空串） */
  author: string | null;
  bookUrl: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  wordCount?: string;
}

/** 搜索结果 + 诊断信息 */
export interface SearchOutcome {
  /** 是否成功拿到搜索结果页并解析（false 表示抓取/配置有问题，不是"没搜到"） */
  ok: boolean;
  list: SearchResult[];
  /** ok=false 时的原因 */
  reason?: string;
}

/**
 * 书籍详情（详情页解析结果，不落库）。
 * 缺失字段统一给 null 而非省略键，保证响应结构稳定，前端不用到处判 undefined。
 */
export interface BookDetail {
  name: string;
  author: string | null;
  coverUrl: string | null;
  intro: string | null;
  kind: string | null;
  wordCount: string | null;
  lastChapter: string | null;
  /** 目录页 URL：书源未配 ruleBookInfo.tocUrl 时回落到详情页 URL，故不会为 null */
  tocUrl: string;
}


@Injectable()
export class CrawlService {
  constructor(
    private readonly http: HttpClient,
    private readonly crawlSourceRepo: CrawlSourceRepository,
    private readonly bookRepo: BookRepository,
    private readonly chapterRepo: BookChapterRepository,
  ) {}

  /** 搜索（对外语义：只要命中列表） */
  async search(sourceId: number, key: string, page = 1): Promise<SearchResult[]> {
    return (await this.searchDetailed(sourceId, key, page)).list;
  }

  /**
   * 带诊断信息的搜索。
   *
   * 与 search 的区别：区分「抓取失败」和「抓到了但 0 命中」。
   * 书源测试必须能分辨这两种情况，否则站点挂掉会被显示成"没搜到"，误导规则调试。
   */
  async searchDetailed(sourceId: number, key: string, page = 1): Promise<SearchOutcome> {
    const source = await this.crawlSourceRepo.findById(sourceId);
    if (!source) throw new NotFoundException(`书源 ${sourceId} 不存在`);
    if (!source.searchUrl) return { ok: false, list: [], reason: '书源未配置 searchUrl' };
    if (!source.ruleSearch?.bookList) return { ok: false, list: [], reason: '书源未配置 ruleSearch.bookList' };

    const req = await this.buildSearchRequest(source, key, page);
    // 书源级 header 兜底，搜索 URL 里自带的 headers 覆盖它（后者更具体）
    const headers = { ...this.sourceHeaders(source), ...req.headers };
    const html =
      req.method === 'POST'
        ? await this.http.post(req.url, req.body, { charset: req.charset, headers })
        : await this.http.get(req.url, req.charset, headers);
    if (!html) return { ok: false, list: [], reason: `搜索请求失败：${req.method} ${req.url}` };

    const rule = source.ruleSearch;
    const listRule = rule.bookList ?? '';

    const isJson = this.isJsonContent(html);
    const records = isJson
      ? await extractListFromJson(listRule, this.fieldRules(rule), html, source.bookSourceUrl)
      : await extractListFromHtml(listRule, this.fieldRules(rule), html, source.bookSourceUrl, key, page);

    const list = records
      .map((r) => ({
        name: r.name ?? '',
        author: r.author ?? null,
        bookUrl: resolveUrl(source.bookSourceUrl, r.bookUrl ?? ''),
        coverUrl: r.coverUrl ? resolveUrl(source.bookSourceUrl, r.coverUrl) : undefined,
        intro: r.intro,
        kind: r.kind,
        wordCount: r.wordCount,
      }))
      .filter((r) => r.name && r.bookUrl);

    return { ok: true, list };
  }

  /**
   * 书籍详情：给一个书籍详情页 URL，找出它属于哪个书源，用该书的 ruleBookInfo 解析后返回。
   *
   * 只解析、不落库（要落库走 crawlBook）。
   * 书源解析顺序：先查 book 表（book.source_id 是精确答案），查不到再按 URL 前缀兜底
   * （还没采集过的书只有 URL 可用）。
   */
  async getBookDetail(bookUrl: string): Promise<BookDetail> {
    const source = await this.resolveSourceByUrl(bookUrl);
    if (!source) throw new NotFoundException(`没有匹配的书源，无法解析该书籍 URL：${bookUrl}`);

    const charset = source.charset ?? 'utf-8';
    const html = await this.http.get(bookUrl, charset, this.sourceHeaders(source));
    if (!html) throw new BadGatewayException(`详情页抓取失败：${bookUrl}`);

    const info = await this.parseBookInfo(source, html, bookUrl);
    if (!info.name) {
      throw new UnprocessableEntityException(
        `详情页解析失败：未取到书名，请检查书源「${source.bookSourceName}」的 ruleBookInfo`,
      );
    }

    return {
      name: info.name,
      author: info.author ?? null,
      coverUrl: info.coverUrl ?? null,
      intro: info.intro ?? null,
      kind: info.kind ?? null,
      wordCount: info.wordCount ?? null,
      lastChapter: info.latestChapterTitle ?? null,
      // 与 crawlBook 的取目录逻辑保持一致：书源没配提示 tocUrl 时，详情页本身就是目录页
      tocUrl: info.tocUrl ?? bookUrl,
    };
  }

  /**
   * 按书籍 URL 找书源。
   *
   * 1. 优先查 book 表：已采集的书有 source_id，直接用，不受 URL 前缀限制
   * 2. 兜底按书源地址前缀匹配（取最长前缀那份，支持同站点多书源）；前缀后必须紧跟 URL 分隔符，
   *    避免 https://a.com 误匹配 https://a.com.evil.net
   */
  private async resolveSourceByUrl(bookUrl: string): Promise<BookSource | null> {
    const known = await this.bookRepo.findByBookUrl(bookUrl);
    if (known) {
      const source = await this.crawlSourceRepo.findById(known.sourceId);
      if (source) return source;
    }

    const sources = await this.crawlSourceRepo.findAllFull();

    let matched: BookSource | null = null;
    let matchedLength = -1;

    for (const source of sources) {
      const base = source.bookSourceUrl.replace(/\/+$/, '');
      if (!base || !bookUrl.startsWith(base)) continue;

      const rest = bookUrl.slice(base.length);
      if (rest !== '' && !/^[/?#:]/.test(rest)) continue;

      if (base.length > matchedLength) {
        matched = source;
        matchedLength = base.length;
      }
    }

    return matched;
  }

  /** 单本采集：详情 + 目录 + 正文 → 落库。maxChapters 限量采集（缺省全量），用于测试/增量。 */
  async crawlBook(sourceId: number, bookUrl: string, maxChapters?: number): Promise<{ bookId: number; chapterCount: number }> {
    const source = await this.crawlSourceRepo.findById(sourceId);
    if (!source) throw new Error('书源不存在');

    const charset = source.charset ?? 'utf-8';

    // 1. 详情页
    const detailHtml = await this.http.get(bookUrl, charset, this.sourceHeaders(source));
    if (!detailHtml) throw new Error('详情页抓取失败');

    const info = await this.parseBookInfo(source, detailHtml, bookUrl);
    // 只校验书名：作者可缺失（部分书源的详情页本就不提供作者）
    if (!info.name) throw new Error('书名解析失败');

    // 2. 落库书籍（同一书源 + 同一 book_url 视为同一本，存在则更新）
    // 去重键与唯一索引 uq_book_source_url 保持一致，避免书名变动后被当成新书 → INSERT 撞唯一键
    const existing = await this.bookRepo.findBySourceUrl(sourceId, bookUrl);
    let bookId: number;
    if (existing) {
      bookId = existing.id;
      await this.bookRepo.update(bookId, info);
    } else {
      bookId = await this.bookRepo.insert({ ...info, bookUrl, sourceId });
    }

    // 3. 目录页
    const tocUrl = info.tocUrl || bookUrl;
    const tocHtml = await this.http.get(tocUrl, charset, this.sourceHeaders(source));
    if (!tocHtml) throw new Error('目录页抓取失败');

    const chapters = await this.parseChapterList(source, tocHtml, tocUrl, charset);
    if (chapters.length === 0) throw new Error('章节目录解析失败');

    const targetChapters = maxChapters ? chapters.slice(0, maxChapters) : chapters;

    // 4. 逐章抓正文落库
    let savedCount = 0;
    for (const chapter of targetChapters) {
      const content = await this.parseChapterContent(source, chapter.url, charset);
      const ok = await this.chapterRepo.insertChapter(bookId, {
        title: chapter.title,
        url: chapter.url,
        index: chapter.index,
        content: content ?? '',
      });
      if (ok) savedCount++;
    }

    // 更新章节数（限量采集时记录实际采集数，全量时记录总数）
    await this.bookRepo.updateTotalChapterNum(bookId, targetChapters.length);

    return { bookId, chapterCount: savedCount };
  }

  // ---- 内部方法（解析逻辑，不碰 DB）----

  /**
   * 解析 searchUrl 为请求配置。
   *
   * 语法对齐 reader-rust：`url` 或 `url,{method,body,headers,charset}`。
   * - {key} 占位替换为 URL 编码后的关键词（POST 时按 charset 编码）
   * - {page} 占位替换为页码
   * - method 缺省 GET；body 缺省空；charset 缺省 utf-8
   *
   * 另外支持 `@js:` / `<js>` 形式：脚本返回真正的 URL。
   * 需要它的场景是「搜索地址会轮换」的站点——脚本先抓首页，从 `<form action>` 里读当前
   * 搜索地址，再拼关键词。脚本内可用 `java.ajax`（已接上带 cookie/header 的 HttpClient）
   * 与 `cookie.removeCookie`。
   */
  private async buildSearchRequest(
    source: BookSource,
    key: string,
    page: number,
  ): Promise<{ method: 'GET' | 'POST'; url: string; body: string; charset: string; headers: Record<string, string> }> {
    const template = source.searchUrl!;
    const trimmed = template.trim();
    const headers = this.sourceHeaders(source);
    const sourceCharset = source.charset ?? 'utf-8';

    let urlPart: string;
    if (trimmed.startsWith('@js:') || trimmed.startsWith('js:') || trimmed.startsWith('<js>')) {
      const script = stripModePrefix(trimmed);
      urlPart = (
        await evalJs(script, {
          baseUrl: source.bookSourceUrl,
          key,
          page,
          sourceKey: source.bookSourceUrl,
          ajax: (spec) => {
            const { url } = parseUrlOptions(spec);
            return this.http
              .get(resolveUrl(source.bookSourceUrl, url), sourceCharset, headers)
              .then((html) => html ?? '');
          },
          clearCookies: (target) => this.http.clearCookies(target ? resolveUrl(source.bookSourceUrl, target) : undefined),
        })
      ).trim();
    } else {
      const encodedKey = encodeKey(key, sourceCharset);
      urlPart = template.replace(/\{key\}/g, encodedKey).replace(/\{page\}/g, String(page));
    }

    // 拆 url 与请求配置 JSON（`url,{...}` 形式，逗号后是合法 JSON 才拆）
    let config: { method?: string; body?: string; headers?: Record<string, string>; charset?: string } = {};
    const commaIdx = urlPart.indexOf(',');
    if (commaIdx >= 0) {
      const maybeJson = urlPart.slice(commaIdx + 1).trim();
      if (maybeJson.startsWith('{')) {
        try {
          config = JSON.parse(maybeJson);
          urlPart = urlPart.slice(0, commaIdx);
        } catch {
          // 不是合法 JSON，当普通 URL（含逗号）
        }
      }
    }

    const method = (config.method ?? 'GET').toUpperCase() as 'GET' | 'POST';
    // 搜索请求的编码优先级：searchUrl 内联配置 > 书源 charset > utf-8
    // （gbk 站点的 searchUrl 可能只写了 {key}，此时必须回落到书源级 charset，否则关键词编码错误）
    const charset = config.charset ?? sourceCharset;

    // 关键词编码：POST 表单时用 charset 对应的编码（gbk 站点需 gbk 编码 key）
    const encodedKey = encodeKey(key, charset);

    // body 里的 {key}/{page} 占位替换
    const body = (config.body ?? '').replace(/\{key\}/g, encodedKey).replace(/\{page\}/g, String(page));

    return {
      method,
      url: resolveUrl(source.bookSourceUrl, urlPart),
      body,
      charset,
      headers: { ...headers, ...config.headers },
    };
  }

  /**
   * 解析书源 header（JSON 字符串）为请求头。
   *
   * 书源配置是人手填的：缺失、非法 JSON、非对象一律降级成「不带自定义头」，
   * 不能因为一条坏配置让整次采集抛错。
   */
  private sourceHeaders(source: BookSource): Record<string, string> {
    const raw = source.header;
    if (!raw || !raw.trim()) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        // 只接受标量：对象/数组作为请求头会被序列化成 "[object Object]"，等于埋了个坏头
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          headers[key] = String(value);
        }
      }
      return headers;
    } catch {
      return {};
    }
  }

  private isJsonContent(html: string): boolean {
    const t = html.trim();
    return (t.startsWith('{') || t.startsWith('[')) && (() => {
      try {
        JSON.parse(t);
        return true;
      } catch {
        return false;
      }
    })();
  }

  private fieldRules(rule: SearchRule): Record<string, string | undefined> {
    return {
      name: rule.name,
      author: rule.author,
      bookUrl: rule.bookUrl,
      coverUrl: rule.coverUrl,
      intro: rule.intro,
      kind: rule.kind,
      lastChapter: rule.lastChapter,
      updateTime: rule.updateTime,
      wordCount: rule.wordCount,
    };
  }

  private async parseBookInfo(source: BookSource, html: string, bookUrl: string) {
    const rule = source.ruleBookInfo ?? {};
    const ctx: EvalContext = { baseUrl: bookUrl, variables: new Map() };

    if (rule.init) {
      await evalFieldOnDoc(rule.init, html, ctx);
    }

    const name = (await evalFieldOnDoc(rule.name, html, ctx)) ?? '';
    // 作者缺失存 null（对应 DB 可空列），不再回落成空串——空串和 NULL 混用会让「有没有作者」判断失真
    const author = (await evalFieldOnDoc(rule.author, html, ctx)) || null;
    const intro = (await evalFieldOnDoc(rule.intro, html, ctx)) ?? undefined;
    const kind = (await evalFieldOnDoc(rule.kind, html, ctx)) ?? undefined;
    const lastChapter = (await evalFieldOnDoc(rule.lastChapter, html, ctx)) ?? undefined;
    const wordCount = (await evalFieldOnDoc(rule.wordCount, html, ctx)) ?? undefined;
    const coverUrlRaw = (await evalFieldOnDoc(rule.coverUrl, html, ctx)) ?? undefined;
    const tocUrlRaw = (await evalFieldOnDoc(rule.tocUrl, html, ctx)) ?? undefined;

    return {
      name,
      author,
      intro,
      kind,
      latestChapterTitle: lastChapter,
      wordCount,
      coverUrl: coverUrlRaw ? resolveUrl(bookUrl, coverUrlRaw) : undefined,
      tocUrl: tocUrlRaw ? resolveUrl(bookUrl, tocUrlRaw) : undefined,
    };
  }

  /**
   * 解析章节目录，支持多页（ruleToc.nextTocUrl 指向「下一页」链接）。
   *
   * 流程：抓当前目录页 → 提取章节 → 若有 nextTocUrl 则解析出下一页地址继续，直到没有下一页。
   * 多页合并后统一按 URL 去重，避免「最新章节区」与「正文卷区」的重复条目。
   */
  private async parseChapterList(source: BookSource, html: string, tocUrl: string, charset = 'utf-8') {
    const rule = source.ruleToc ?? {};
    const listRule = rule.chapterList ?? '';
    if (!listRule) return [];

    const allRecords: Record<string, string>[] = [];
    let currentUrl = tocUrl;
    let currentHtml = html;
    const headers = this.sourceHeaders(source);
    const MAX_PAGES = 50; // 防死循环：目录最多 50 页（5 万章，远超任何现实书籍）
    const visited = new Set<string>();

    for (let page = 0; page < MAX_PAGES; page++) {
      if (visited.has(currentUrl)) break;
      visited.add(currentUrl);

      const isJson = this.isJsonContent(currentHtml);
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

      const nextHtml = await this.http.get(nextUrl, charset, headers);
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

    /**
     * 按 URL 去重，保留**最后一次**出现的位置。
     *
     * 很多站点的目录页是「最新章节 9 条（倒序）+ 完整目录（正序）」拼在一张列表里，
     * 前 9 条与完整目录尾部重复。倒着扫一遍保留后者，就能得到「完整且正序」的目录；
     * 顺扫保留前者会得到「最新 9 条在最前面、中间缺一段」的错序目录。
     */
    const deduped = dedupeChaptersByUrl(mapped);
    return deduped.map((chapter, i) => ({ ...chapter, index: i }));
  }

  /**
   * 抓取单章正文，支持多页拼接（nextContentUrl）。
   * 流程：抓当前页 → 提取正文 → 若有 nextContentUrl 则抓下一页拼接，直到无下一页或达到上限。
   */
  private async parseChapterContent(source: BookSource, chapterUrl: string, charset = 'utf-8'): Promise<string | null> {
    const rule = source.ruleContent ?? {};
    const { applyLegadoRegex } = await import('../parser/regex.js');

    const parts: string[] = [];
    let currentUrl = chapterUrl;
    const headers = this.sourceHeaders(source);
    const MAX_PAGES = 20; // 防死循环：最多抓 20 页
    const visited = new Set<string>();

    for (let page = 0; page < MAX_PAGES; page++) {
      if (visited.has(currentUrl)) break; // 防环
      visited.add(currentUrl);

      const html = await this.http.get(currentUrl, charset, headers);
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

    return parts.length > 0 ? parts.join('\n') : null;
  }
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

/**
 * 按目标编码对关键词做 URL 编码。
 * utf-8 用原生 encodeURIComponent；gbk/gb2312 等用 iconv-lite 编码成字节后百分号编码，
 * 否则 POST/GET 到 gbk 站点的表单时中文关键词会乱码。
 */
function encodeKey(key: string, charset: string): string {
  const cs = (charset || 'utf-8').toLowerCase();
  if (cs === 'utf-8' || cs === 'utf8') {
    return encodeURIComponent(key);
  }
  try {
    // 非 utf-8（如 gbk/gb2312）用 iconv-lite 编码后做百分号编码
    const bytes = iconv.encode(key, cs === 'gb2312' ? 'gb2312' : 'gbk');
    return Array.from(bytes)
      .map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
      .join('');
  } catch {
    return encodeURIComponent(key);
  }
}
