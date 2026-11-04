import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookRepository, type BookMetadataPatch as RepoMetadataPatch, type BookSummary } from '../../../common/repo/book.repo.js';
import { CrawlSourceRepository } from '../../../common/repo/crawl-source.repo.js';
import { isAdmin, type Viewer } from '../../../common/authz/role.js';
import { assertBookAccessible, ownerScope } from './book-access.js';
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
 *
 * 身份相关的两条规则（细节见 book-access.ts）：
 * - 管理员看全部；作家只看/只改自己名下的书；owner 为 null 的系统书只有管理员能动。
 * - 归属转移只能由管理员发起，作家新建的书一律归自己。
 */
@Injectable()
export class BookService {
  constructor(
    private readonly repo: BookRepository,
    private readonly sourceRepo: CrawlSourceRepository,
  ) {}

  async list(query: ListBookQuery, viewer: Viewer): Promise<BookListResult> {
    const { list, total } = await this.repo.findAllWithChapterCount({
      ...query,
      // 归属过滤下沉到 SQL：分页的 total 才不会把别人的书算进去
      ownerId: ownerScope(viewer),
    });
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  /** 详情：顺带做归属校验，所以内部调用方（replace/patch/remove）可以直接复用它 */
  async get(id: number, viewer: Viewer): Promise<BookSummary> {
    const found = await this.repo.findDetailById(id);
    if (!found) throw new NotFoundException(`书籍 ${id} 不存在`);
    assertBookAccessible(found, viewer);
    return found;
  }

  /**
   * 手动新增书籍。
   *
   * book.source_id 的外键已被移除，数据库不会拦「指向不存在的书源」，
   * 所以这里必须自己校验书源存在——但仅当 sourceId 非空时（手动导入的书可能没有书源）。
   * 重复校验依赖 (source_id, book_url)，两者任一为空则跳过（无法作为唯一标识）。
   */
  async create(input: CreateBookInput, viewer: Viewer): Promise<{ id: number }> {
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
      wordCount: input.wordCount ?? undefined,
      latestChapterTitle: input.latestChapterTitle ?? undefined,
      totalChapterNum: input.totalChapterNum ?? null,
      ownerId: this.resolveOwnerOnCreate(input.ownerId ?? null, viewer),
    });
    return { id };
  }

  /** 全量覆盖元数据（PUT）：未传的元数据字段会被置 null；归属不在「置空」范围内 */
  async replace(id: number, input: BookMetadataInput, viewer: Viewer): Promise<{ id: number }> {
    const current = await this.get(id, viewer);

    await this.repo.updateMetadata(id, {
      name: input.name,
      author: input.author ?? null,
      coverUrl: input.coverUrl ?? null,
      intro: input.intro ?? null,
      wordCount: input.wordCount ?? null,
      latestChapterTitle: input.latestChapterTitle ?? null,
      totalChapterNum: input.totalChapterNum ?? null,
      ownerId: this.resolveOwnerOnUpdate(current.ownerId, input.ownerId, viewer),
    });
    return { id };
  }

  /** 部分更新元数据（PATCH）：只改传入字段，null 表示显式清空 */
  async patch(id: number, patch: BookMetadataPatch, viewer: Viewer): Promise<{ id: number }> {
    const current = await this.get(id, viewer);

    const repoPatch: RepoMetadataPatch = { ...patch };
    repoPatch.ownerId = this.resolveOwnerOnUpdate(current.ownerId, patch.ownerId, viewer);

    await this.repo.updateMetadata(id, repoPatch);
    return { id };
  }

  /**
   * 删除书籍。
   * 章节与正文由 BookRepository 在同一事务里显式删除（外键级联已移除）。
   */
  async remove(id: number, viewer: Viewer): Promise<{ id: number; deleted: number }> {
    await this.get(id, viewer);
    const deleted = await this.repo.deleteById(id);
    if (deleted === 0) throw new NotFoundException(`书籍 ${id} 不存在`);
    return { id, deleted };
  }

  /**
   * 批量删除，返回实际删除行数（ids 里不存在的会被忽略）。
   *
   * 作家批量删除时要求「选中的全部是自己的书」：静默跳过别人的书会让前端
   * 看到「选了 5 本只删了 2 本」却不知道为什么，不如直接 403 说清。
   */
  async removeMany(ids: number[], viewer: Viewer): Promise<{ deleted: number; ids: number[] }> {
    const scope = ownerScope(viewer);
    if (scope) {
      const owned = await this.repo.filterOwnedIds(ids, scope);
      if (owned.length !== ids.length) {
        throw new ForbiddenException('选择中包含不属于你的书籍');
      }
    }

    const deleted = await this.repo.deleteMany(ids);
    return { deleted, ids };
  }

  /** 建书时的归属：管理员可指定（null = 系统书），作家强制归自己 */
  private resolveOwnerOnCreate(requested: string | null, viewer: Viewer): string | null {
    if (isAdmin(viewer)) return requested;
    if (requested !== null && requested !== viewer.id) {
      throw new ForbiddenException('只有管理员可以把书归属给其他账号');
    }
    return viewer.id;
  }

  /**
   * 更新时的归属：不传 = 不改；传了只有管理员能生效。
   *
   * 刻意不用 PUT 的「不传即置空」语义——归属被一次普通元数据保存顺手改掉，
   * 后果是书突然从作家后台消失（变成系统书），比少传一个字段更难排查。
   */
  private resolveOwnerOnUpdate(
    current: string | null,
    requested: string | null | undefined,
    viewer: Viewer,
  ): string | null {
    if (requested === undefined) return current;
    if (!isAdmin(viewer)) {
      throw new ForbiddenException('只有管理员可以调整书籍归属');
    }
    return requested;
  }
}
