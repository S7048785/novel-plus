import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/database.js';
import { bookChapter, bookContent } from '../../db/schema.js';

/**
 * 章节 Repository：负责 book_chapter 与 book_content 表的读写。
 * 两者强关联（正文以 chapter_id 唯一关联目录），合并到一个 repo 便于一起写入。
 */

export interface ChapterData {
  title: string;
  url: string;
  index: number;
  content: string;
}

/** 列表行：不带正文（一章正文几 KB，一页几十上百章全带会把响应撑爆） */
export interface ChapterSummary {
  id: number;
  bookId: number;
  title: string;
  url: string;
  index: number;
  /** 正文字数（CHAR_LENGTH），无正文为 0 */
  contentLength: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 详情：列表字段 + 正文 */
export interface ChapterDetail extends ChapterSummary {
  content: string | null;
}

export interface ChapterCreateData {
  title: string;
  url: string;
  /** 缺省时自动追加到末尾（max(index)+1） */
  index?: number;
  content?: string | null;
}

export interface ChapterPatch {
  title?: string;
  url?: string;
  index?: number;
  /** 不传 = 不动正文；传 null = 删除正文；传字符串 = 覆盖 */
  content?: string | null;
}

/** 列表/详情的公共字段选择，含正文字数 */
const summarySelection = {
  id: bookChapter.id,
  bookId: bookChapter.bookId,
  title: bookChapter.title,
  url: bookChapter.url,
  index: bookChapter.index,
  // CHAR_LENGTH 在 MySQL 返回 BIGINT，显式 cast 成 SIGNED 让 mysql2 给 number 而不是字符串
  contentLength: sql<number>`cast(coalesce(char_length(${bookContent.content}), 0) as signed)`,
  createdAt: bookChapter.createdAt,
  updatedAt: bookChapter.updatedAt,
};

@Injectable()
export class BookChapterRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * 采集用：插入一章（目录 + 正文），返回是否成功。
   * 正文为空时仍写目录、跳过正文。
   */
  async insertChapter(bookId: number, chapter: ChapterData): Promise<boolean> {
    const now = new Date();
    const [ch] = await this.db
      .insert(bookChapter)
      .values({
        bookId,
        title: chapter.title,
        url: chapter.url,
        index: chapter.index,
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    const chapterId = ch?.id ?? 0;
    if (!chapterId) return false;

    if (chapter.content) {
      await this.db.insert(bookContent).values({
        chapterId,
        content: chapter.content,
        createdAt: now,
        updatedAt: now,
      });
    }
    return true;
  }

  /** 后台管理：按书分页列章节，按 index 升序（目录顺序） */
  async findByBook(bookId: number, page: number, pageSize: number): Promise<{ list: ChapterSummary[]; total: number }> {
    const [totalRow] = await this.db
      .select({ value: count() })
      .from(bookChapter)
      .where(eq(bookChapter.bookId, bookId));
    const total = Number(totalRow?.value ?? 0);
    if (total === 0) return { list: [], total };

    const list = await this.db
      .select(summarySelection)
      .from(bookChapter)
      .leftJoin(bookContent, eq(bookContent.chapterId, bookChapter.id))
      .where(eq(bookChapter.bookId, bookId))
      .orderBy(asc(bookChapter.index), asc(bookChapter.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { list, total };
  }

  /** 后台管理：单章详情（含正文） */
  async findDetailById(chapterId: number): Promise<ChapterDetail | null> {
    const rows = await this.db
      .select({ ...summarySelection, content: bookContent.content })
      .from(bookChapter)
      .leftJoin(bookContent, eq(bookContent.chapterId, bookChapter.id))
      .where(eq(bookChapter.id, chapterId))
      .limit(1);

    return rows[0] ?? null;
  }

  /** 该书当前最大 index（自动追加章节用）；无章节时返回 0 */
  async maxIndex(bookId: number): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`cast(coalesce(max(${bookChapter.index}), -1) as signed)` })
      .from(bookChapter)
      .where(eq(bookChapter.bookId, bookId));
    return Number(row?.value ?? -1);
  }

  /** 同一本书里 url 相同的章节 id（没有则 null），用于新增/改地址时的重复校验 */
  async findIdByUrl(bookId: number, url: string): Promise<number | null> {
    const rows = await this.db
      .select({ id: bookChapter.id })
      .from(bookChapter)
      .where(and(eq(bookChapter.bookId, bookId), eq(bookChapter.url, url)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /**
   * 该书已存在的章节 url 集合（去重后的 Set，剔除 null），用于采集增量判断：
   * 源站目录里 url 已在此集合中的章节视为「已入库」，跳过不再重复插入。
   * 一次性查全量比逐章 findIdByUrl 少 N 次查询，采集几百章时差异明显。
   */
  async findExistingUrls(bookId: number): Promise<Set<string>> {
    const rows = await this.db
      .select({ url: bookChapter.url })
      .from(bookChapter)
      .where(eq(bookChapter.bookId, bookId));
    return new Set(rows.map((r) => r.url).filter((u): u is string => !!u));
  }

  async create(bookId: number, data: ChapterCreateData): Promise<number> {
    const now = new Date();
    const index = data.index ?? (await this.maxIndex(bookId)) + 1;

    const [created] = await this.db
      .insert(bookChapter)
      .values({
        bookId,
        title: data.title,
        url: data.url,
        index,
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    const chapterId = created?.id ?? 0;
    if (!chapterId) return 0;

    if (data.content) {
      await this.upsertContent(chapterId, data.content);
    }
    return chapterId;
  }

  async update(chapterId: number, patch: ChapterPatch): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.url !== undefined) set.url = patch.url;
    if (patch.index !== undefined) set.index = patch.index;

    if (Object.keys(set).length > 1) {
      await this.db.update(bookChapter).set(set).where(eq(bookChapter.id, chapterId));
    }

    if (patch.content !== undefined) {
      if (patch.content === null || patch.content === '') {
        await this.db.delete(bookContent).where(eq(bookContent.chapterId, chapterId));
      } else {
        await this.upsertContent(chapterId, patch.content);
      }
    }
  }

  /** 正文按 chapter_id 唯一，用 onDuplicateKeyUpdate 一条语句搞定新建或覆盖 */
  private async upsertContent(chapterId: number, content: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(bookContent)
      .values({ chapterId, content, createdAt: now, updatedAt: now })
      .onDuplicateKeyUpdate({ set: { content, updatedAt: now } });
  }

  /** 删除单章，返回受影响行数。正文在同一事务里显式清理（不再依赖外键级联） */
  async deleteById(chapterId: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.delete(bookContent).where(eq(bookContent.chapterId, chapterId));
      const [result] = await tx.delete(bookChapter).where(eq(bookChapter.id, chapterId));
      return result?.affectedRows ?? 0;
    });
  }

  /** 批量删除（限定在 bookId 内，避免跨书误删）。正文在同一事务里显式清理 */
  async deleteMany(bookId: number, chapterIds: number[]): Promise<number> {
    if (chapterIds.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      await tx.delete(bookContent).where(inArray(bookContent.chapterId, chapterIds));
      const [result] = await tx
        .delete(bookChapter)
        .where(and(eq(bookChapter.bookId, bookId), inArray(bookChapter.id, chapterIds)));
      return result?.affectedRows ?? 0;
    });
  }
}
