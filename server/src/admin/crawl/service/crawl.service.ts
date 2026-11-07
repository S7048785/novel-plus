import { BadGatewayException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { extractListFromHtml, extractListFromJson } from '../parser/rule-engine.js';
import { resolveUrl } from '../crawler/url.js';
import { HttpClient } from '../crawler/http-client.js';
import { CrawlSourceRepository } from '../../../common/repo/crawl-source.repo.js';
import { BookRepository } from '../../../common/repo/book.repo.js';
import { BookChapterRepository } from '../../../common/repo/book-chapter.repo.js';
import type { BookSource, SearchRule } from '../../../common/model/book-source.js';
import { buildSearchRequest, isJsonContent, sourceHeaders } from '../crawler/source-request.js';
import { parseBookInfo } from '../parser/book-info.parser.js';
import { parseChapterContent, parseChapterList } from '../parser/chapter.parser.js';

/**
 * 采集编排服务（复刻 reader-rust 的 search_books / get_book_info / get_chapter_list / get_chapter_content）
 *
 * 只做编排：抓取 → 解析 → 调 repo 落库。所有 DB 操作下沉到 repo 层；
 * 解析与请求构建拆在旁边的三个模块（source-request / book-info.parser / chapter.parser），
 * 本文件不出现规则引擎与 HTML 的细节。
 */

export interface SearchResult {
  name: string;
  /** 作者可缺失，缺失时为 null（与 book.author 可空一致，不回落成空串） */
  author: string | null;
  bookUrl: string;
  coverUrl?: string;
  intro?: string;
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
  wordCount: string | null;
  lastChapter: string | null;
  /** 目录页 URL：书源未配 ruleBookInfo.tocUrl 时回落到详情页 URL，故不会为 null */
  tocUrl: string;
}

/**
 * 把正文字符总数格式化成与源站标称一致的展示格式。
 *
 * 源站的 wordCount 是「25.9 万」这种给人看的字符串，统计出的字符数若原样入库
 * （如「259345」）会和列表里其它书格式不一。1 万以内保留原数，亿以上用「亿」。
 * 导出供测试；口径：CHAR_LENGTH（含标点、换行），与源站计法可能略有差异，以实际落库为准。
 */
export function formatWordCount(charCount: number): string {
  if (charCount < 10000) return String(charCount);
  if (charCount < 100000000) {
    return `${(charCount / 10000).toFixed(1).replace(/\.0$/, '')} 万`;
  }
  return `${(charCount / 100000000).toFixed(2).replace(/\.?0+$/, '')} 亿`;
}

/** 搜索规则 → 字段提取规则。ruleSearch 的键名与 SearchResult 对齐。 */
function fieldRules(rule: SearchRule): Record<string, string | undefined> {
  return {
    name: rule.name,
    author: rule.author,
    bookUrl: rule.bookUrl,
    coverUrl: rule.coverUrl,
    intro: rule.intro,
    lastChapter: rule.lastChapter,
    wordCount: rule.wordCount,
  };
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

    const req = await buildSearchRequest(source, key, page, this.http);
    // 书源级 header 兜底，搜索 URL 里自带的 headers 覆盖它（后者更具体）
    const headers = { ...sourceHeaders(source), ...req.headers };
    const html =
      req.method === 'POST'
        ? await this.http.post(req.url, req.body, { charset: req.charset, headers })
        : await this.http.get(req.url, req.charset, headers);
    if (!html) return { ok: false, list: [], reason: `搜索请求失败：${req.method} ${req.url}` };

    const rule = source.ruleSearch;
    const listRule = rule.bookList ?? '';

    const records = isJsonContent(html)
      ? await extractListFromJson(listRule, fieldRules(rule), html, source.bookSourceUrl)
      : await extractListFromHtml(listRule, fieldRules(rule), html, source.bookSourceUrl, key, page);

    const list = records
      .map((r) => ({
        name: r.name ?? '',
        author: r.author ?? null,
        bookUrl: resolveUrl(source.bookSourceUrl, r.bookUrl ?? ''),
        coverUrl: r.coverUrl ? resolveUrl(source.bookSourceUrl, r.coverUrl) : undefined,
        intro: r.intro,
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
    const html = await this.http.get(bookUrl, charset, sourceHeaders(source));
    if (!html) throw new BadGatewayException(`详情页抓取失败：${bookUrl}`);

    const info = await parseBookInfo(source, html, bookUrl);
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
      wordCount: info.wordCount ?? null,
      lastChapter: info.latestChapterTitle ?? null,
      // 与 crawlBook 的取目录逻辑保持一致：书源没配提示 tocUrl 时，详情页本身就是目录页
      tocUrl: info.tocUrl ?? bookUrl,
    };
  }

  /** 单本采集：详情 + 目录 + 正文 → 落库。maxChapters 限量采集（缺省全量），用于测试/增量。 */
  async crawlBook(sourceId: number, bookUrl: string, maxChapters?: number): Promise<{ bookId: number; chapterCount: number }> {
    const source = await this.crawlSourceRepo.findById(sourceId);
    if (!source) throw new Error('书源不存在');

    const charset = source.charset ?? 'utf-8';

    // 1. 详情页
    const detailHtml = await this.http.get(bookUrl, charset, sourceHeaders(source));
    if (!detailHtml) throw new Error('详情页抓取失败');

    const info = await parseBookInfo(source, detailHtml, bookUrl);
    // 只校验书名：作者可缺失（部分书源的详情页本就不提供作者）
    if (!info.name) throw new Error('书名解析失败');

    // 2. 落库书籍（同一书源 + 同一 book_url 视为同一本，存在则更新）
    // 去重键与唯一索引 uq_book_source_url 保持一致，避免书名变动后被当成新书 → INSERT 撞唯一键
    const existing = await this.bookRepo.findBySourceUrl(sourceId, bookUrl);
    let bookId: number;
    if (existing) {
      bookId = existing.id;
      // 详情页的 wordCount / latestChapterTitle 是源站标称值：只在新书首次入库时作初始参考。
      // 增量更新不能拿标称值覆盖上一轮的实际统计——万一这轮在统计步骤前失败，
      // 书上留着的还是上次采集的真实数据，而不是源站一句过时的「25.9 万」。
      const { wordCount: _wc, latestChapterTitle: _lc, ...rest } = info;
      void _wc;
      void _lc;
      await this.bookRepo.update(bookId, rest);
    } else {
      // origin 显式写 crawl：insert 的默认值是 manual（后台手填的场景），
      // 采集入库必须标清渠道，否则「按来源统计」会把采集来的书算成手动导入
      bookId = await this.bookRepo.insert({ ...info, bookUrl, sourceId, origin: 'crawl' });
    }

    // 3. 目录页
    const tocUrl = info.tocUrl || bookUrl;
    const tocHtml = await this.http.get(tocUrl, charset, sourceHeaders(source));
    if (!tocHtml) throw new Error('目录页抓取失败');

    const chapters = await parseChapterList(source, tocHtml, tocUrl, charset, this.http);
    if (chapters.length === 0) throw new Error('章节目录解析失败');

    const targetChapters = maxChapters ? chapters.slice(0, maxChapters) : chapters;

    // 4. 逐章抓正文落库（增量：跳过已入库的章节，只插入源站新出现的章节）
    // 判断依据是章节 url（与目录去重一致）：同一本书内 url 已存在即视为已采集，
    // 源站更新后再次采集只补新增章节，不重复插入旧章节。
    const existingUrls = existing ? await this.chapterRepo.findExistingUrls(bookId) : new Set<string>();
    let savedCount = 0;
    for (const chapter of targetChapters) {
      if (existingUrls.has(chapter.url)) continue;
      const content = await parseChapterContent(source, chapter.url, chapter.title, charset, this.http);
      const ok = await this.chapterRepo.insertChapter(bookId, {
        title: chapter.title,
        url: chapter.url,
        index: chapter.index,
        content: content ?? '',
      });
      if (ok) savedCount++;
    }

    // 5. 采集后统计：总章数 / 最新章节 / 字数都以实际落库数据为准，回写 book 表。
    // 全量统计该书的章节与正文（增量采集只补新章节，旧章节照常计入），
    // 限量采集时统计值就是已采部分——这与「以落库为准」的口径一致，不取源站标称。
    const stats = await this.chapterRepo.collectStats(bookId);
    await this.bookRepo.updateMetadata(bookId, {
      totalChapterNum: stats.total,
      latestChapterTitle: stats.latestTitle,
      wordCount: formatWordCount(stats.wordCount),
    });

    return { bookId, chapterCount: savedCount };
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
    // known.sourceId 可空（手动导入的书没有书源），仅当有 sourceId 时才反查书源
    if (known && known.sourceId != null) {
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
}
