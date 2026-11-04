import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookRepository, type BookMetadataPatch as RepoMetadataPatch, type BookSummary } from '../../../common/repo/book.repo.js';
import { CrawlSourceRepository } from '../../../common/repo/crawl-source.repo.js';
import { UserRepository } from '../../../common/repo/user.repo.js';
import { UserRoleRepository } from '../../../common/repo/user-role.repo.js';
import { DEFAULT_BOOK_ORIGIN } from '../../../common/book/origin.js';
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
 * 与 CrawlService 分工：采集侧（搜索、详情解析、落库）在 CrawlService，
 * 这里只做已入库书籍的管理，不触发任何抓取。
 *
 * 两个描述「书从哪来 / 归谁」的字段，容易混，一次说清：
 * - origin：**入库方式**（crawl / author / manual），系统能自己判定的渠道；
 * - author_id：**归属作家账号**（user.id），null 表示无主。
 *   采集来的书只有 origin=crawl、没有归属；作家上传的书两者都有。
 */
@Injectable()
export class BookService {
  constructor(
    private readonly repo: BookRepository,
    private readonly sourceRepo: CrawlSourceRepository,
    private readonly userRepo: UserRepository,
    private readonly roleRepo: UserRoleRepository,
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

    if (input.authorId != null) await this.assertAuthor(input.authorId);

    const id = await this.repo.insert({
      name: input.name,
      author: input.author ?? null,
      bookUrl: input.bookUrl ?? null,
      sourceId: input.sourceId ?? null,
      coverUrl: input.coverUrl ?? undefined,
      tocUrl: input.tocUrl ?? undefined,
      intro: input.intro ?? undefined,
      wordCount: input.wordCount ?? undefined,
      latestChapterTitle: input.latestChapterTitle ?? undefined,
      totalChapterNum: input.totalChapterNum ?? null,
      origin: input.origin ?? DEFAULT_BOOK_ORIGIN,
      authorId: input.authorId ?? null,
    });
    return { id };
  }

  /** 全量覆盖元数据（PUT）：未传的元数据字段会被置 null；origin / authorId 不传则保持原值 */
  async replace(id: number, input: BookMetadataInput): Promise<{ id: number }> {
    const current = await this.get(id);

    if (input.authorId != null) await this.assertAuthor(input.authorId);

    await this.repo.updateMetadata(id, {
      name: input.name,
      author: input.author ?? null,
      coverUrl: input.coverUrl ?? null,
      intro: input.intro ?? null,
      wordCount: input.wordCount ?? null,
      latestChapterTitle: input.latestChapterTitle ?? null,
      totalChapterNum: input.totalChapterNum ?? null,
      // origin 描述「书怎么来的」，不跟着「未传即置空」走，避免一次保存把渠道改成默认值
      origin: input.origin ?? current.origin,
      // 归属同理：不传 = 不改；要清空归属得显式传 null
      authorId: input.authorId === undefined ? current.authorId : input.authorId,
    });
    return { id };
  }

  /** 部分更新元数据（PATCH）：只改传入字段，null 表示显式清空 */
  async patch(id: number, patch: BookMetadataPatch): Promise<{ id: number }> {
    const repoPatch: RepoMetadataPatch = { ...patch };
    await this.get(id); // 不存在直接 404，避免 update 静默命中 0 行
    if (patch.authorId != null) await this.assertAuthor(patch.authorId);
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

  /**
   * 校验归属账号可用：必须存在，且持有 author 身份。
   *
   * 为什么要查身份而不是只查存在：把书指派给一个纯读者账号，对方既进不了后台也调不了接口，
   * 这本书就成了「有主但谁也管不了」——比无主更糟，属于静默的数据错误。
   */
  private async assertAuthor(authorId: string): Promise<void> {
    const existed = await this.userRepo.findById(authorId);
    if (!existed) throw new BadRequestException(`账号 ${authorId} 不存在`);

    const isAuthor = await this.roleRepo.hasRole(authorId, 'author');
    if (!isAuthor) {
      throw new BadRequestException(`账号 ${existed.name} 不是作家（缺少 author 身份），不能作为书籍归属`);
    }
  }
}
