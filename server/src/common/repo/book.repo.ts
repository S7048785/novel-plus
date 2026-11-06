import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, like, or } from 'drizzle-orm';
import { DB, type Db } from '../../db/database.js';
import { book, bookChapter, bookContent, crawlSource, user, type BookRow, type NewBookRow } from '../../db/schema.js';
import { DEFAULT_BOOK_ORIGIN, type BookOrigin } from '../book/origin.js';

/**
 * 书籍 Repository：负责 book 表的读写。
 */
export interface BookUpsertData {
  name: string;
  /**
   * 作者：可缺失。部分书源不提供作者，用 null（而非空串）表示「没有」，
   * 与 DB 列 author varchar NULL 的语义保持一致。
   */
  author?: string | null;
  /** 源站书籍地址；手动导入的书为 null */
  bookUrl?: string | null;
  /** 书源 id；手动导入的书为 null（不属于任何书源） */
  sourceId?: number | null;
  coverUrl?: string;
  tocUrl?: string;
  intro?: string;
  wordCount?: string;
  latestChapterTitle?: string;
  totalChapterNum?: number | null;
  /** 入库方式：crawl / author / manual，不传则用默认值 manual */
  origin?: BookOrigin;
  /**
   * 归属作家账号（user.id）。
   *
   * 只在「新增」和「后台改归属」时写入；采集路径（update）不碰它——
   * 采集是覆盖元数据，不该把管理员指派好的归属冲掉。
   */
  authorId?: string | null;
}

/** 列表/详情返回的行：book 字段 + 书源名 + 已采集章节数 */
export interface BookSummary {
  id: number;
  name: string;
  author: string | null;
  coverUrl: string | null;
  /** 书籍原始页面地址（后台需要能跳回书源站点）；手动导入的书为 null */
  bookUrl: string | null;
  sourceId: number | null;
  /** 书源名（book.source_id 关联 crawl_source；书源被删时可为 null） */
  sourceName: string | null;
  wordCount: string | null;
  latestChapterTitle: string | null;
  totalChapterNum: number | null;
  tocUrl: string | null;
  intro: string | null;
  /** 入库方式：crawl（爬虫采集）/ author（作家上传）/ manual（手动导入） */
  origin: BookOrigin;
  /** 归属作家账号 id；null = 无主（采集入库的书、或账号被删后遗留） */
  authorId: string | null;
  /** 归属作家的账号昵称（join user 得到；无主时为 null） */
  authorName: string | null;
  /** book_chapter 里实际落库的章节数 */
  chapterCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListBookFilter {
  page: number;
  pageSize: number;
  /** 同时匹配书名与作者 */
  keyword?: string;
  sourceId?: number;
  /** 入库方式筛选 */
  origin?: BookOrigin;
}

/** 后台管理可编辑的元数据（含 null 表示清空） */
export interface BookMetadataPatch {
  name?: string;
  author?: string | null;
  coverUrl?: string | null;
  intro?: string | null;
  wordCount?: string | null;
  latestChapterTitle?: string | null;
  totalChapterNum?: number | null;
  origin?: BookOrigin;
  /** 归属作家账号；null = 移除归属（变回无主） */
  authorId?: string | null;
}

/** 列表/详情的公共字段选择 */
const summarySelection = {
  id: book.id,
  name: book.name,
  author: book.author,
  coverUrl: book.coverUrl,
  bookUrl: book.bookUrl,
  sourceId: book.sourceId,
  sourceName: crawlSource.sourceName,
  wordCount: book.wordCount,
  latestChapterTitle: book.latestChapterTitle,
  totalChapterNum: book.totalChapterNum,
  tocUrl: book.tocUrl,
  intro: book.intro,
  origin: book.origin,
  authorId: book.authorId,
  /** 归属作家的账号昵称；两个查询都要 leftJoin(user)，没归属时自然为 null */
  authorName: user.name,
  createdAt: book.createdAt,
  updatedAt: book.updatedAt,
};

@Injectable()
export class BookRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * 按「书源 + 书籍地址」查书——与唯一键 uq_book_source_url 对齐。
   *
   * 不用书名+作者查：书名/作者是展示字段，站点侧可被编辑，改动后会 miss 到不存在的记录，
   * 进而 INSERT 撞唯一键；同一书源内 book_url 才是稳定标识。
   */
  async findBySourceUrl(sourceId: number, bookUrl: string): Promise<BookRow | null> {
    const rows = await this.db
      .select()
      .from(book)
      .where(and(eq(book.sourceId, sourceId), eq(book.bookUrl, bookUrl)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 按书籍 URL 查书（不限定书源）。
   * 用于「给一个书籍 URL，反查它属于哪个书源」——book.source_id 是精确答案，
   * 比按 URL 前缀猜书源可靠。同一 URL 可能被多个书源收录，取最新一条。
   */
  async findByBookUrl(bookUrl: string): Promise<BookRow | null> {
    const rows = await this.db.select().from(book).where(eq(book.bookUrl, bookUrl)).orderBy(desc(book.id)).limit(1);
    return rows[0] ?? null;
  }

  async insert(data: BookUpsertData): Promise<number> {
    const now = new Date();
    const [result] = await this.db
      .insert(book)
      .values({
        name: data.name,
        author: data.author ?? null,
        bookUrl: data.bookUrl ?? null,
        sourceId: data.sourceId ?? null,
        coverUrl: data.coverUrl,
        tocUrl: data.tocUrl,
        intro: data.intro,
        wordCount: data.wordCount,
        latestChapterTitle: data.latestChapterTitle,
        totalChapterNum: data.totalChapterNum ?? null,
        origin: data.origin ?? DEFAULT_BOOK_ORIGIN,
        authorId: data.authorId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    return result?.id ?? 0;
  }

  async update(id: number, data: Partial<BookUpsertData>): Promise<void> {
    const set: Partial<NewBookRow> = { updatedAt: new Date() };
    if (data.name !== undefined) set.name = data.name;
    // author 用真值判断而非 !== undefined：详情页某次没解析出作者（null/空串）不该把库里已有的作者覆盖成空
    if (data.author) set.author = data.author;
    if (data.coverUrl !== undefined) set.coverUrl = data.coverUrl;
    if (data.tocUrl !== undefined) set.tocUrl = data.tocUrl;
    if (data.intro !== undefined) set.intro = data.intro;
    if (data.wordCount !== undefined) set.wordCount = data.wordCount;
    if (data.latestChapterTitle !== undefined) set.latestChapterTitle = data.latestChapterTitle;
    await this.db.update(book).set(set).where(eq(book.id, id));
  }

  /**
   * 后台管理：分页列表 + 筛选。
   *
   * 章节数只对「当前页的 id」做一次分组统计，避免 join + group by 与分页混用带来的偏差。
   */
  async findAllWithChapterCount(filter: ListBookFilter): Promise<{ list: BookSummary[]; total: number }> {
    const conditions = [];
    if (filter.keyword) {
      // 转义 LIKE 通配符，避免用户输入的 % / _ 变成模糊匹配
      const kw = `%${filter.keyword.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(or(like(book.name, kw), like(book.author, kw)));
    }
    if (filter.sourceId !== undefined) conditions.push(eq(book.sourceId, filter.sourceId));
    if (filter.origin !== undefined) conditions.push(eq(book.origin, filter.origin));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await this.db.select({ value: count() }).from(book).where(where);
    const total = Number(totalRow?.value ?? 0);
    if (total === 0) return { list: [], total };

    const rows = await this.db
      .select(summarySelection)
      .from(book)
      .leftJoin(crawlSource, eq(crawlSource.id, book.sourceId))
      .leftJoin(user, eq(user.id, book.authorId))
      .where(where)
      .orderBy(desc(book.id))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    const chapterCounts = await this.countChaptersByBookIds(rows.map((r) => r.id));

    return { list: rows.map((r) => ({ ...r, chapterCount: chapterCounts.get(r.id) ?? 0 })), total };
  }

  /** 后台管理：单本详情（含书源名与章节数） */
  async findDetailById(id: number): Promise<BookSummary | null> {
    const rows = await this.db
      .select(summarySelection)
      .from(book)
      .leftJoin(crawlSource, eq(crawlSource.id, book.sourceId))
      .leftJoin(user, eq(user.id, book.authorId))
      .where(eq(book.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    const chapterCount = await this.countChapters(id);
    return { ...rows[0], chapterCount };
  }

  async countChapters(bookId: number): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(bookChapter).where(eq(bookChapter.bookId, bookId));
    return Number(row?.value ?? 0);
  }

  private async countChaptersByBookIds(bookIds: number[]): Promise<Map<number, number>> {
    if (bookIds.length === 0) return new Map();
    const rows = await this.db
      .select({ bookId: bookChapter.bookId, value: count() })
      .from(bookChapter)
      .where(inArray(bookChapter.bookId, bookIds))
      .groupBy(bookChapter.bookId);
    return new Map(rows.map((r) => [r.bookId, Number(r.value)]));
  }

  /**
   * 后台管理：更新元数据。
   *
   * 与采集用的 update 不同：这里 null 表示「清空」，所以用 !== undefined 判断而不是真值判断
   * （采集路径不能把已有作者覆盖成空，后台管理是人工显式操作，应当如实落库）。
   */
  async updateMetadata(id: number, patch: BookMetadataPatch): Promise<void> {
    const set: Partial<NewBookRow> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.author !== undefined) set.author = patch.author;
    if (patch.coverUrl !== undefined) set.coverUrl = patch.coverUrl;
    if (patch.intro !== undefined) set.intro = patch.intro;
    if (patch.wordCount !== undefined) set.wordCount = patch.wordCount;
    if (patch.latestChapterTitle !== undefined) set.latestChapterTitle = patch.latestChapterTitle;
    if (patch.totalChapterNum !== undefined) set.totalChapterNum = patch.totalChapterNum;
    if (patch.origin !== undefined) set.origin = patch.origin;
    if (patch.authorId !== undefined) set.authorId = patch.authorId;

    await this.db.update(book).set(set).where(eq(book.id, id));
  }

  /**
   * 把指定账号名下的书全部改为无主（author_id = null）。
   *
   * 删账号时调用：book.author_id 是弱引用（没建外键），不清就会留下指向不存在账号的 id，
   * join 出来的 authorName 为 null、列表显示「—」，看着像数据坏了。
   * 书本身保留——内容不该跟着账号一起消失。
   */
  async clearAuthorByUserIds(userIds: string[]): Promise<number> {
    if (userIds.length === 0) return 0;
    const [result] = await this.db
      .update(book)
      .set({ authorId: null, updatedAt: new Date() })
      .where(inArray(book.authorId, userIds));
    return result?.affectedRows ?? 0;
  }

  /**
   * 书是否存在——章节接口每次操作都要先确认书在，
   * 没必要把 intro、目录地址这些大字段一起读出来。
   */
  async existsById(id: number): Promise<boolean> {
    const rows = await this.db.select({ id: book.id }).from(book).where(eq(book.id, id)).limit(1);
    return rows.length > 0;
  }

  /**
   * 删除单本，返回受影响行数。
   * 章节与正文在同一事务里显式删除（book_chapter/book_content 的外键已移除，级联由这里负责）。
   */
  async deleteById(id: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.delete(bookContent).where(inArray(bookContent.chapterId, this.chapterIdSubquery(tx, id)));
      await tx.delete(bookChapter).where(eq(bookChapter.bookId, id));
      const [result] = await tx.delete(book).where(eq(book.id, id));
      return result?.affectedRows ?? 0;
    });
  }

  /** 批量删除，返回受影响行数（ids 里不存在的会被忽略） */
  async deleteMany(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      await tx.delete(bookContent).where(inArray(bookContent.chapterId, this.chapterIdSubquery(tx, ...ids)));
      await tx.delete(bookChapter).where(inArray(bookChapter.bookId, ids));
      const [result] = await tx.delete(book).where(inArray(book.id, ids));
      return result?.affectedRows ?? 0;
    });
  }

  /** 事务里查「这些书的全部章节 id」子查询，供级联删除 book_content 用 */
  private chapterIdSubquery(tx: Pick<Db, 'select'>, ...bookIds: number[]) {
    return tx
      .select({ id: bookChapter.id })
      .from(bookChapter)
      .where(bookIds.length === 1 ? eq(bookChapter.bookId, bookIds[0]) : inArray(bookChapter.bookId, bookIds));
  }
}
