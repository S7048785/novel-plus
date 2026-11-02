import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookRepository } from '../../../common/repo/book.repo.js';
import {
  BookChapterRepository,
  type ChapterDetail,
  type ChapterSummary,
} from '../../../common/repo/book-chapter.repo.js';
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
 */
@Injectable()
export class BookChapterService {
  constructor(
    private readonly chapterRepo: BookChapterRepository,
    private readonly bookRepo: BookRepository,
  ) {}

  async list(bookId: number, query: ListChapterQuery): Promise<ChapterListResult> {
    await this.assertBook(bookId);
    const { list, total } = await this.chapterRepo.findByBook(bookId, query.page, query.pageSize);
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  /** 详情：含正文 */
  async get(bookId: number, chapterId: number): Promise<ChapterDetail> {
    return this.findOwned(bookId, chapterId);
  }

  async create(bookId: number, input: CreateChapterInput): Promise<{ id: number }> {
    await this.assertBook(bookId);

    const duplicated = await this.chapterRepo.findIdByUrl(bookId, input.url);
    if (duplicated) {
      throw new ConflictException(`该章节地址已存在（chapterId=${duplicated}）`);
    }

    const id = await this.chapterRepo.create(bookId, input);
    return { id };
  }

  async update(bookId: number, chapterId: number, patch: UpdateChapterInput): Promise<{ id: number }> {
    await this.findOwned(bookId, chapterId);

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
  async remove(bookId: number, chapterId: number): Promise<{ id: number; deleted: number }> {
    await this.findOwned(bookId, chapterId);
    const deleted = await this.chapterRepo.deleteById(chapterId);
    return { id: chapterId, deleted };
  }

  /** 批量删除：只在本书范围内生效，ids 里不属于该书的会被忽略 */
  async removeMany(bookId: number, ids: number[]): Promise<{ deleted: number; ids: number[] }> {
    await this.assertBook(bookId);
    const deleted = await this.chapterRepo.deleteMany(bookId, ids);
    return { deleted, ids };
  }

  private async assertBook(bookId: number): Promise<void> {
    const found = await this.bookRepo.findDetailById(bookId);
    if (!found) throw new NotFoundException(`书籍 ${bookId} 不存在`);
  }

  /** 取章节并校验归属，不存在或不属于该书都按 404 处理 */
  private async findOwned(bookId: number, chapterId: number): Promise<ChapterDetail> {
    const chapter = await this.chapterRepo.findDetailById(chapterId);
    if (!chapter || chapter.bookId !== bookId) {
      throw new NotFoundException(`书籍 ${bookId} 下不存在章节 ${chapterId}`);
    }
    return chapter;
  }
}
