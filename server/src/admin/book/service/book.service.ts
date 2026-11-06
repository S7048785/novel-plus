import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookRepository, type BookMetadataPatch as RepoMetadataPatch, type BookSummary } from '../../../common/repo/book.repo.js';
import { CrawlSourceRepository } from '../../../common/repo/crawl-source.repo.js';
import { DEFAULT_BOOK_ORIGIN } from '../../../common/book/origin.js';
import type { BookMetadataInput, BookMetadataPatch, CreateBookInput } from '@novel-plus/shared/dto';
import type { ListBookQuery } from '../dto/book.query.schema.js';

export interface BookListResult {
  list: BookSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 书籍后台管理：列表 / 详情 / 新增 / 编辑元数据 / 删除。
 *
 * 与 CrawlService 分工：采集侧（搜索、详情解析、落库）在 CrawlService，
 * 这里只做已入库书籍的管理，不触发任何抓取。
 *
 * 两个描述「书从哪来 / 归谁」的字段，容易混，一次说清：
 * - origin：**入库方式**（crawl / author / manual），后台可以改，是请求体的一部分；
 * - author_id：**归属作家账号**（user.id），null 表示无主。后台接口不接收它——
 *   归属应由作家端按当前登录账号写入（作家端尚未上线），管理员手填既没有依据也不安全。
 *
 * 同理，字数 / 最新章节 / 总章数是采集与章节同步的产物，只由 CrawlService 写，
 * 后台的请求体不接收、PUT 也不会清空它们。
 */
@Injectable()
export class BookService {
  constructor(
    private readonly repo: BookRepository,
    private readonly sourceRepo: CrawlSourceRepository,
  ) {}

  async list(query: ListBookQuery): Promise<BookListResult> {
    const { list, total } = await this.repo.findAllWithChapterCount(query);
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: number): Promise<BookSummary> {
    const found = await this.repo.findDetailById(id);
    if (!found) throw new NotFoundException(`书籍 ${id} 不存在`);
    return found;
  }

  /**
   * 手动新增书籍。
   *
   * book.source_id 的外键已被移除，数据库不会拦「指向不存在的书源」，
   * 所以这里必须自己校验书源存在——但仅当 sourceId 非空时（手动导入的书可能没有书源）。
   * 重复校验依赖 (source_id, book_url)，两者任一为空则跳过（无法作为唯一标识）。
   *
   * origin 不传时默认 manual（后台手填进来的就是「手动导入」）；
   * 采集入库走 CrawlService（那边写 crawl），「作家上传」由将来的作家端显式传。
   */
  async create(input: CreateBookInput): Promise<{ id: number }> {
    if (input.sourceId != null) {
      const source = await this.sourceRepo.findById(input.sourceId);
      if (!source) throw new BadRequestException(`书源 ${input.sourceId} 不存在`);
    }

    if (input.sourceId != null && input.bookUrl != null) {
      const existed = await this.repo.findBySourceUrl(input.sourceId, input.bookUrl);
      if (existed) {
        throw new ConflictException(`该书籍已存在（id=${existed.id}，${existed.name}）`);
      }
    }

    const id = await this.repo.insert({
      name: input.name,
      author: input.author ?? null,
      bookUrl: input.bookUrl ?? null,
      sourceId: input.sourceId ?? null,
      coverUrl: input.coverUrl ?? undefined,
      tocUrl: input.tocUrl ?? undefined,
      intro: input.intro ?? undefined,
      origin: input.origin ?? DEFAULT_BOOK_ORIGIN,
    });
    return { id };
  }

  /**
   * 全量覆盖元数据（PUT）：未传的 author / coverUrl / intro 置 null；origin 不传则保持原值。
   *
   * 采集统计值与归属不在这里出现，updateMetadata 只 set 传入的键，因此不会被这次保存清空。
   */
  async replace(id: number, input: BookMetadataInput): Promise<{ id: number }> {
    const current = await this.get(id);

    await this.repo.updateMetadata(id, {
      name: input.name,
      author: input.author ?? null,
      coverUrl: input.coverUrl ?? null,
      intro: input.intro ?? null,
      // origin 描述「书怎么来的」，不跟着「未传即置空」走，避免一次保存把渠道改成默认值
      origin: input.origin ?? current.origin,
    });
    return { id };
  }

  /** 部分更新元数据（PATCH）：只改传入字段，null 表示显式清空 */
  async patch(id: number, patch: BookMetadataPatch): Promise<{ id: number }> {
    const repoPatch: RepoMetadataPatch = { ...patch };
    await this.get(id); // 不存在直接 404，避免 update 静默命中 0 行
    await this.repo.updateMetadata(id, repoPatch);
    return { id };
  }

  /** 删除书籍：章节与正文由 BookRepository 在同一事务里显式删除（外键级联已移除） */
  async remove(id: number): Promise<{ id: number; deleted: number }> {
    const deleted = await this.repo.deleteById(id);
    if (deleted === 0) throw new NotFoundException(`书籍 ${id} 不存在`);
    return { id, deleted };
  }

  /** 批量删除，返回实际删除行数（ids 里不存在的会被忽略） */
  async removeMany(ids: number[]): Promise<{ deleted: number; ids: number[] }> {
    const deleted = await this.repo.deleteMany(ids);
    return { deleted, ids };
  }

}
