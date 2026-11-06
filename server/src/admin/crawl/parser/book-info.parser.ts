import { evalFieldOnDoc, type EvalContext } from './rule-engine.js';
import { resolveUrl } from '../crawler/url.js';

import type { BookSource } from '../../../common/model/book-source.js';

/**
 * 详情页解析：按书源的 ruleBookInfo 把 HTML 翻成结构化的书籍信息。
 *
 * 纯解析，不碰 DB、不碰 HTTP——抓页面是编排层的事，这里只管「拿到 HTML 之后怎么读」。
 */

/** parseBookInfo 的返回。coverUrl/tocUrl 已按详情页 URL 解析成绝对地址。 */
export interface ParsedBookInfo {
  name: string;
  /** 作者缺失存 null（对应 DB 可空列），不回落成空串——空串和 NULL 混用会让「有没有作者」判断失真 */
  author: string | null;
  intro?: string;
  latestChapterTitle?: string;
  /** 源站标称字数（如「25.9 万」）；只作新书首次入库的初始参考，采集后统计会覆盖它 */
  wordCount?: string;
  coverUrl?: string;
  tocUrl?: string;
}

export async function parseBookInfo(source: BookSource, html: string, bookUrl: string): Promise<ParsedBookInfo> {
  const rule = source.ruleBookInfo ?? {};
  const ctx: EvalContext = { baseUrl: bookUrl, variables: new Map() };

  if (rule.init) {
    await evalFieldOnDoc(rule.init, html, ctx);
  }

  const name = (await evalFieldOnDoc(rule.name, html, ctx)) ?? '';
  const author = (await evalFieldOnDoc(rule.author, html, ctx)) || null;
  const intro = (await evalFieldOnDoc(rule.intro, html, ctx)) ?? undefined;
  const lastChapter = (await evalFieldOnDoc(rule.lastChapter, html, ctx)) ?? undefined;
  const wordCount = (await evalFieldOnDoc(rule.wordCount, html, ctx)) ?? undefined;
  const coverUrlRaw = (await evalFieldOnDoc(rule.coverUrl, html, ctx)) ?? undefined;
  const tocUrlRaw = (await evalFieldOnDoc(rule.tocUrl, html, ctx)) ?? undefined;

  return {
    name,
    author,
    intro,
    latestChapterTitle: lastChapter,
    wordCount,
    coverUrl: coverUrlRaw ? resolveUrl(bookUrl, coverUrlRaw) : undefined,
    tocUrl: tocUrlRaw ? resolveUrl(bookUrl, tocUrlRaw) : undefined,
  };
}
