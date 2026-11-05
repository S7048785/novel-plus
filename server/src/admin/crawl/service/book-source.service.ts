import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CrawlSourceRepository, type CrawlSourceSummary, type ListSourceFilter } from '../../../common/repo/crawl-source.repo.js';
import { CrawlService } from './crawl.service.js';
import type { BookSource } from '../../../common/model/book-source.js';
import type { BookSourceInput, BookSourcePatch } from '@novel-plus/shared/dto';

/** 书源测试结果 */
export interface SourceTestResult {
  /** 规则是否跑通（抓取成功且解析出结果页）。0 命中但抓取成功时仍为 true */
  ok: boolean;
  costMs: number;
  total: number;
  list: Awaited<ReturnType<CrawlService['search']>>;
  /** ok=false 时的原因 */
  error?: string;
}

/**
 * 书源的增删改查与测试。
 *
 * 与 CrawlService 分开：那边是采集编排（search/crawlBook），这边是书源这条配置数据的 CRUD。
 * 测试书源复用 CrawlService.searchDetailed，不重复实现抓取逻辑。
 */
@Injectable()
export class BookSourceService {
  constructor(
    private readonly repo: CrawlSourceRepository,
    private readonly crawlService: CrawlService,
  ) {}

  list(filter: ListSourceFilter = {}): Promise<CrawlSourceSummary[]> {
    return this.repo.findAll(filter);
  }

  /** 详情：含完整规则体 */
  async get(id: number): Promise<BookSource> {
    const source = await this.repo.findById(id);
    if (!source) throw new NotFoundException(`书源 ${id} 不存在`);
    return source;
  }

  async create(input: BookSourceInput): Promise<{ id: number }> {
    const existed = await this.repo.findByUrl(input.bookSourceUrl);
    if (existed) throw new ConflictException(`书源地址已存在（id=${existed.id}，${existed.bookSourceName}）`);

    const id = await this.repo.insert(toBookSource(input));
    return { id };
  }

  /**
   * 全量覆盖（PUT）：请求体即最终配置。
   * 注意未携带的字段会被清空——只想改个别字段请用 patch。
   */
  async replace(id: number, input: BookSourceInput): Promise<{ id: number }> {
    await this.get(id); // 不存在直接 404
    return this.save(id, toBookSource(input));
  }

  /**
   * 部分更新（PATCH）：以库里的配置为底，只用请求里的字段覆盖。
   * 典型场景：列表页的启用/停用开关只传 { enabled: false }，规则体原样保留。
   */
  async patch(id: number, changes: BookSourcePatch): Promise<{ id: number }> {
    const existing = await this.get(id);
    return this.save(id, { ...existing, ...changes } as BookSource);
  }

  /** 落库前统一校验地址冲突（uq_crawl_source_url），PUT/PATCH 共用 */
  private async save(id: number, next: BookSource): Promise<{ id: number }> {
    // 允许改地址，但不能改成别的书源已在用的地址
    const sameUrl = await this.repo.findByUrl(next.bookSourceUrl);
    if (sameUrl && sameUrl.id !== id) {
      throw new ConflictException(`书源地址已被其他书源占用（id=${sameUrl.id}，${sameUrl.bookSourceName}）`);
    }

    await this.repo.updateConfig(id, next);
    return { id };
  }

  /**
   * 删除书源。
   *
   * 只删配置行，不动 book 表：book.source_id 到 crawl_source 的外键已移除，
   * 已采集的书籍/章节/正文保留，删除书源不会连带清掉内容。
   */
  async remove(id: number): Promise<{ id: number; deleted: number }> {
    const deleted = await this.repo.deleteById(id);
    if (deleted === 0) throw new NotFoundException(`书源 ${id} 不存在`);
    return { id, deleted };
  }

  /** 批量删除，返回实际删除行数（ids 里不存在的会被忽略） */
  async removeMany(ids: number[]): Promise<{ deleted: number; ids: number[] }> {
    const deleted = await this.repo.deleteMany(ids);
    return { deleted, ids };
  }

  /** 测试书源：用关键词跑一次搜索，返回命中结果、耗时与失败原因 */
  async test(id: number, key: string, page = 1): Promise<SourceTestResult> {
    const source = await this.get(id); // 不存在 404
    const startedAt = Date.now();

    let outcome: Awaited<ReturnType<CrawlService['searchDetailed']>>;
    try {
      outcome = await this.crawlService.searchDetailed(id, key, page);
    } catch (e) {
      // 规则引擎/JS 执行等异常也要以结构化结果返回，让前端能展示，而不是 500
      return {
        ok: false,
        costMs: Date.now() - startedAt,
        total: 0,
        list: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }

    return {
      ok: outcome.ok,
      costMs: Date.now() - startedAt,
      total: outcome.list.length,
      list: outcome.list,
      error: outcome.reason,
    };
  }
}

/**
 * 入参 → 领域模型。
 *
 * schema 用 looseObject，未知字段保留在对象里（规则体原样透传），这里只做类型收窄。
 */
function toBookSource(input: BookSourceInput): BookSource {
  return input as unknown as BookSource;
}
