import {
  boolean,
  datetime,
  index,
  int,
  json,
  mediumtext,
  mysqlTable,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
// 表结构是全项目共享的，json 列的类型契约来自 crawl 领域模型。
// 仅 type import，编译期擦除，不产生运行时依赖（db ← crawl 的方向只在类型层出现）。
import type { BookSourceConfig } from '../common/model/book-source.js';

/**
 * 书源表
 *
 * 设计：书源是「一坨配置」而非「一组可查询实体」，规则（ruleSearch/ruleToc/ruleContent/ruleBookInfo 等）
 * 全部塞进 json 一列，只保留几个有实际用途的标量列：
 * - sourceUrl：唯一标识 + 去重（对齐 reader-rust 拿它当主键）
 * - sourceName：列表页展示，避免每次反序列化整个 json
 * - enabled：是否启用采集（用户手动开关，高频操作，单列更新比读写整个 json 轻）
 * - status：运行可用性（0=可用，1=不可用），采集失败时系统自动标记，避免反复撞已挂掉的站
 *
 * json 列承载 BookSourceConfig（纯配置），序列化/反序列化的类型契约见 model/book-source.ts。
 */
export const crawlSource = mysqlTable(
  'crawl_source',
  {
    id: int('id').autoincrement().primaryKey(),
    sourceUrl: varchar('source_url', { length: 512 }).notNull(),
    sourceName: varchar('source_name', { length: 255 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    status: tinyint('status').notNull().default(0),
    json: json('json').notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_crawl_source_url').on(t.sourceUrl)],
);

/** json 列承载的配置类型（MySQL json 列在 Drizzle 里 data 固定 unknown，这里显式声明语义类型） */
export type CrawlSourceJson = BookSourceConfig;

/**
 * 书籍表
 *
 * author 可空：部分书源列表页不提供作者，采集时允许缺失。
 * 去重键用 (source_id, book_url) 而非 (name, author)：
 * - author 可空后，(name, author) 唯一索引对 NULL 行失效（MySQL 认为多个 NULL 互不相等）
 * - 书名/作者是展示字段，站点侧能被编辑；book_url 是稳定标识，同一书源内唯一
 */
export const book = mysqlTable(
  'book',
  {
    id: int('id').autoincrement().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    author: varchar('author', { length: 255 }),
    bookUrl: varchar('book_url', { length: 512 }).notNull(),
    // 不声明外键：book.source_id → crawl_source 的外键已从库中移除，
    // 目的是删书源时保留已采集的书籍（删除源只删配置，不动内容）
    sourceId: int('source_id').notNull(),
    coverUrl: varchar('cover_url', { length: 512 }),
    tocUrl: varchar('toc_url', { length: 512 }),
    intro: text('intro'),
    kind: varchar('kind', { length: 255 }),
    wordCount: varchar('word_count', { length: 64 }),
    latestChapterTitle: varchar('latest_chapter_title', { length: 255 }),
    totalChapterNum: int('total_chapter_num'),
    updateTime: varchar('update_time', { length: 64 }),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [index('idx_book_source').on(t.sourceId), uniqueIndex('uq_book_source_url').on(t.sourceId, t.bookUrl)],
);

/**
 * 章节目录表
 */
export const bookChapter = mysqlTable(
  'book_chapter',
  {
    id: int('id').autoincrement().primaryKey(),
    bookId: int('book_id')
      .notNull()
      .references(() => book.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 512 }).notNull(),
    url: varchar('url', { length: 512 }).notNull(),
    index: int('index').notNull(),
    isVip: boolean('is_vip').notNull().default(false),
    isPay: boolean('is_pay').notNull().default(false),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [index('idx_chapter_book').on(t.bookId, t.index)],
);

/**
 * 章节正文表
 */
export const bookContent = mysqlTable(
  'book_content',
  {
    id: int('id').autoincrement().primaryKey(),
    chapterId: int('chapter_id')
      .notNull()
      .references(() => bookChapter.id, { onDelete: 'cascade' }),
    content: mediumtext('content'),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_content_chapter').on(t.chapterId)],
);

export type CrawlSourceRow = typeof crawlSource.$inferSelect;
export type NewCrawlSourceRow = typeof crawlSource.$inferInsert;
export type BookRow = typeof book.$inferSelect;
export type NewBookRow = typeof book.$inferInsert;
export type BookChapterRow = typeof bookChapter.$inferSelect;
export type NewBookChapterRow = typeof bookChapter.$inferInsert;
export type BookContentRow = typeof bookContent.$inferSelect;
export type NewBookContentRow = typeof bookContent.$inferInsert;
