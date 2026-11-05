import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookRepository } from '../../../common/repo/book.repo.js';
import {
  BookChapterRepository,
  type ChapterDetail,
  type ChapterSummary,
} from '../../../common/repo/book-chapter.repo.js';
import type { CreateChapterInput, UpdateChapterInput } from '@novel-plus/shared/dto';
import type { ListChapterQuery } from '../dto/chapter.schema.js';

export interface ChapterListResult {
  list: ChapterSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 章节后台管理：目录的增删改查（正文随章节一起维护）。
 *
 * 所有操作都限定在 /admin/book/:bookId 下：章节脱离书没有意义，
 * 每次操作都校验章节确实属于该书，避免拿错 chapterId 改到别的书里。
 *
 * 这里只做「书存在 + 章节属于该书」的校验，不再有归属判断：
 * book.owner_id 已移除（改为记录入库方式），权限统一由 controller 上的 @Roles('admin') 管控。
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

    const duplicated = await this.chapterRepo.findIdByUrl(bookId, input.url ?? null);
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

  /** 书是否存在（只查 id，不读 intro 等大字段），章节的每个操作都要走一次 */
  private async assertBook(bookId: number): Promise<void> {
    const exists = await this.bookRepo.existsById(bookId);
    if (!exists) throw new NotFoundException(`书籍 ${bookId} 不存在`);
  }

  /** 取章节并确认它在这本书下（否则一律 404，不区分「不存在」与「不在本书里」） */
  private async findOwned(bookId: number, chapterId: number): Promise<ChapterDetail> {
    await this.assertBook(bookId);

    const chapter = await this.chapterRepo.findDetailById(chapterId);
    if (!chapter || chapter.bookId !== bookId) {
      throw new NotFoundException(`书籍 ${bookId} 下不存在章节 ${chapterId}`);
    }
    return chapter;
  }
}
