import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookRepository } from '../../../common/repo/book.repo.js';
import {
  BookChapterRepository,
  type ChapterDetail,
  type ChapterSummary,
} from '../../../common/repo/book-chapter.repo.js';
import { assertBookAccessible } from './book-access.js';
import type { Viewer } from '../../../common/authz/role.js';
import type { CreateChapterInput, ListChapterQuery, UpdateChapterInput } from '../dto/chapter.schema.js';

export interface ChapterListResult {
  list: ChapterSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 章节后台管理：目录的增删改查（正文随章节一起维护）。
 *
 * 所有操作都限定在 /book/:bookId 下：章节脱离书没有意义，
 * 每次操作都校验章节确实属于该书，避免拿错 chapterId 改到别的书里。
 *
 * 权限不写在章节上而是继承自书：章节没有独立的归属，能改这本书的人才能改它的章节。
 * 所以每个入口都先过 assertBook(bookId, viewer)，而不是单独查章节的 owner。
 */
@Injectable()
export class BookChapterService {
  constructor(
    private readonly chapterRepo: BookChapterRepository,
    private readonly bookRepo: BookRepository,
  ) {}

  async list(bookId: number, query: ListChapterQuery, viewer: Viewer): Promise<ChapterListResult> {
    await this.assertBook(bookId, viewer);
    const { list, total } = await this.chapterRepo.findByBook(bookId, query.page, query.pageSize);
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  /** 详情：含正文 */
  async get(bookId: number, chapterId: number, viewer: Viewer): Promise<ChapterDetail> {
    return this.findOwned(bookId, chapterId, viewer);
  }

  async create(bookId: number, input: CreateChapterInput, viewer: Viewer): Promise<{ id: number }> {
    await this.assertBook(bookId, viewer);

    const duplicated = await this.chapterRepo.findIdByUrl(bookId, input.url ?? null);
    if (duplicated) {
      throw new ConflictException(`该章节地址已存在（chapterId=${duplicated}）`);
    }

    const id = await this.chapterRepo.create(bookId, input);
    return { id };
  }

  async update(
    bookId: number,
    chapterId: number,
    patch: UpdateChapterInput,
    viewer: Viewer,
  ): Promise<{ id: number }> {
    await this.findOwned(bookId, chapterId, viewer);

    if (patch.url !== undefined) {
      const other = await this.chapterRepo.findIdByUrl(bookId, patch.url);
      if (other && other !== chapterId) {
        throw new ConflictException(`该章节地址已被其他章节占用（chapterId=${other}）`);
      }
    }

    await this.chapterRepo.update(chapterId, patch);
    return { id: chapterId };
  }

  /** 删除章节：正文由 book_content.chapter_id 外键级联删除 */
  async remove(bookId: number, chapterId: number, viewer: Viewer): Promise<{ id: number; deleted: number }> {
    await this.findOwned(bookId, chapterId, viewer);
    const deleted = await this.chapterRepo.deleteById(chapterId);
    return { id: chapterId, deleted };
  }

  /** 批量删除：只在本书范围内生效，ids 里不属于该书的会被忽略 */
  async removeMany(
    bookId: number,
    ids: number[],
    viewer: Viewer,
  ): Promise<{ deleted: number; ids: number[] }> {
    await this.assertBook(bookId, viewer);
    const deleted = await this.chapterRepo.deleteMany(bookId, ids);
    return { deleted, ids };
  }

  /**
   * 书存在 + 当前请求者有权改它。
   * 只查归属字段（不读 intro 等大字段），章节的每个操作都要走一次。
   */
  private async assertBook(bookId: number, viewer: Viewer): Promise<void> {
    const found = await this.bookRepo.findOwnershipById(bookId);
    if (!found) throw new NotFoundException(`书籍 ${bookId} 不存在`);
    assertBookAccessible(found, viewer);
  }

  /** 取章节并校验归属：先过书的权限，再确认章节确实在这本书下（否则一律 404） */
  private async findOwned(bookId: number, chapterId: number, viewer: Viewer): Promise<ChapterDetail> {
    await this.assertBook(bookId, viewer);

    const chapter = await this.chapterRepo.findDetailById(chapterId);
    if (!chapter || chapter.bookId !== bookId) {
      throw new NotFoundException(`书籍 ${bookId} 下不存在章节 ${chapterId}`);
    }
    return chapter;
  }
}
