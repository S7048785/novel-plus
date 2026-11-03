import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookRepository, type BookMetadataPatch as RepoMetadataPatch, type BookSummary } from '../../../common/repo/book.repo.js';
import { CrawlSourceRepository } from '../../../common/repo/crawl-source.repo.js';
import type { BookMetadataInput, BookMetadataPatch, CreateBookInput } from '../dto/book.payload.schema.js';
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
 * 与 CrawlService 分工：采集侧（搜索、详情解析、drop 落库）在 CrawlService，
 * 这里只做已入库书籍的管理，不触发任何抓取。
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
   * 所以这里必须自己校验书源存在——否则会落一条 source_id 悬空的书。
   */
  async create(input: CreateBookInput): Promise<{ id: number }> {
    const source = await this.sourceRepo.findById(input.sourceId);
    if (!source) throw new BadRequestException(`书源 ${input.sourceId} 不存在`);

    const existed = await this.repo.findBySourceUrl(input.sourceId, input.bookUrl);
    if (existed) {
      throw new ConflictException(`该书籍已存在（id=${existed.id}，${existed.name}）`);
    }

    const id = await this.repo.insert({
      name: input.name,
      author: input.author ?? null,
      bookUrl: input.bookUrl,
      sourceId: input.sourceId,
      coverUrl: input.coverUrl ?? undefined,
      tocUrl: input.tocUrl ?? undefined,
      intro: input.intro ?? undefined,
      kind: input.kind ?? undefined,
      wordCount: input.wordCount ?? undefined,
      latestChapterTitle: input.latestChapterTitle ?? undefined,
      updateTime: input.updateTime ?? null,
      totalChapterNum: input.totalChapterNum ?? null,
    });
    return { id };
  }

  /** 全量覆盖元数据（PUT）：请求里没传的元数据字段会被置 null */
  async replace(id: number, input: BookMetadataInput): Promise<{ id: number }> {
    await this.get(id);
    await this.repo.updateMetadata(id, {
      name: input.name,
      author: input.author ?? null,
      coverUrl: input.coverUrl ?? null,
      intro: input.intro ?? null,
      kind: input.kind ?? null,
      wordCount: input.wordCount ?? null,
      latestChapterTitle: input.latestChapterTitle ?? null,
      totalChapterNum: input.totalChapterNum ?? null,
      updateTime: input.updateTime ?? null,
    });
    return { id };
  }

  /** 部分更新元数据（PATCH）：只改传入字段，null 表示显式清空 */
  async patch(id: number, patch: BookMetadataPatch): Promise<{ id: number }> {
    await this.get(id);
    await this.repo.updateMetadata(id, patch as RepoMetadataPatch);
    return { id };
  }

  /**
   * 删除书籍。
   * 章节与正文由 BookRepository 在同一事务里显式删除（外键级联已移除）。
   */
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
