import type { BookOrigin } from '../common/book/origin.js';
import {
  boolean,
  datetime,
  index,
  int,
  json,
  mediumtext,
  mysqlTable,
  primaryKey,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
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
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    author: varchar('author', { length: 255 }),
    // bookUrl / sourceId 可空：采集的书有源站地址与书源，手动导入的书两者都没有。
    bookUrl: varchar('book_url', { length: 512 }),
    // 不声明外键：book.source_id → crawl_source 的外键已从库中移除，
    // 目的是删书源时保留已采集的书籍（删除源只删配置，不动内容）
    sourceId: int('source_id'),
    coverUrl: varchar('cover_url', { length: 512 }),
    tocUrl: varchar('toc_url', { length: 512 }),
    intro: text('intro'),
    wordCount: varchar('word_count', { length: 64 }),
    latestChapterTitle: varchar('latest_chapter_title', { length: 255 }),
    totalChapterNum: int('total_chapter_num'),
    /**
     * 入库方式：crawl（爬虫采集）/ author（作家上传）/ manual（手动导入）。
     *
     * 与 source_id 是两个维度，别混：source_id 是「从哪个站点采集」，origin 是「怎么进的库」。
     * 取值由 common/book/origin.ts 的 BOOK_ORIGINS 约束，列只给长度（varchar(16)），
     * 理由与 user_role.role 相同：加第四种方式时不用 ALTER。
     *
     * 默认 crawl 是给历史数据兜底——0006 之前入库的书全是采集来的。
     */
    origin: varchar('origin', { length: 16 }).$type<BookOrigin>().notNull().default('crawl'),
    /**
     * 归属作家账号（user.id）：这本书归谁，作家端靠它做「只能管自己的书」。
     *
     * 与 author 列是两件事，别混：
     * - author（varchar）是「书上印的作者名」，展示用，可能是笔名、也可能为空；
     * - author_id 是「哪个后台账号拥有这本书」。
     * 采集来的书通常有 author 却没有 author_id（不属于任何账号）；作家上传的书两者都有。
     *
     * 不声明外键，理由与 source_id / origin 一致：删账号不该连带删书。
     * 账号被删时由 UserService 把这一列置 null（书留着，变回无主），不让库里留悬空 id。
     */
    authorId: varchar('author_id', { length: 36 }),

    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [
    index('idx_book_source').on(t.sourceId),
    index('idx_book_origin').on(t.origin),
    index('idx_book_author').on(t.authorId),
    uniqueIndex('uq_book_source_url').on(t.sourceId, t.bookUrl),
  ],
);

/**
 * 章节目录表
 *
 * 不再声明外键（book_id → book、以及 book_content.chapter_id → book_chapter 均已移除）。
 * 级联删除改由应用层在事务里显式执行：删书前先删章节、删章节前先删正文。
 * 理由与 book.source_id 相同：级联清理是业务行为，显式写出来比依赖隐式 ON DELETE CASCADE 更可控、
 * 也更容易在代码里审查；同时避免 DB 外键约束在批量操作/测试清库时带来额外开销。
 */
export const bookChapter = mysqlTable(
  'book_chapter',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    bookId: int('book_id', { unsigned: true }).notNull(),
    title: varchar('title', { length: 512 }).notNull(),
    // url 可空：采集的章节有源站地址，手动导入的章节没有；null 表示「无源站地址」。
    url: varchar('url', { length: 512 }),
    index: int('index').notNull(),
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
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    chapterId: int('chapter_id', { unsigned: true }).notNull(),
    content: mediumtext('content'),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_content_chapter').on(t.chapterId)],
);

/* ============================== 鉴权（better-auth） ============================== */

/**
 * better-auth 要求的 4 张核心表：user / session / account / verification。
 *
 * 命名约定与表结构的两条硬约束（改之前先看清楚）：
 * 1. **表名保持单数默认值**（user/session/...）。drizzle adapter 按模型名查表，
 *    想把表名改成 users 就得在 auth 配置里逐个写 modelName，收益为零。
 * 2. **属性名必须保持 camelCase**（emailVerified、userId...）。adapter 认的是 drizzle 的属性名，
 *    属性名就是 better-auth 的字段契约；列名用 snake_case 只是 `varchar('email_verified')`
 *    第一参的表达，DB 侧命名规范与库的契约互不干扰。
 *
 * 时间列用 datetime 而非 timestamp：timestamp 在 MySQL 里随 session time_zone 做隐式时区换算，
 * 服务器时区漂移会让已存会话的 expires_at 整体偏移，datetime 存的是字面值不会有这个问题。
 */

/** 用户表：id 由 better-auth 生成（32 位随机串，varchar(36) 留余量），email 唯一且建库时已小写化 */
export const user = mysqlTable(
  'user',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    /** 无 SMTP，注册流程也没开，该列会一直是 false；保留是为了将来接邮箱验证时不用改表 */
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('uq_user_email').on(t.email)],
);

/** 会话表：登录态存在这里（不是 JWT），token 是 cookie 里的明文凭据，必须唯一 */
export const session = mysqlTable(
  'session',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    token: varchar('token', { length: 255 }).notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('uq_session_token').on(t.token), index('idx_session_user').on(t.userId)],
);

/**
 * 账号表：一个用户可挂多个登录方式，(providerId, accountId) 标识第三方身份。
 * 邮箱+密码登录对应 providerId='credential'、accountId=用户 id，密码哈希（scrypt）放在 password 列。
 */
export const account = mysqlTable(
  'account',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: datetime('access_token_expires_at', { fsp: 3 }),
    refreshTokenExpiresAt: datetime('refresh_token_expires_at', { fsp: 3 }),
    scope: text('scope'),
    password: text('password'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [index('idx_account_user').on(t.userId)],
);

/** 校验表：邮箱验证 / 找回密码的一次性 token 落在这里；当前两个流程都没开，表先建好 */
export const verification = mysqlTable(
  'verification',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: text('value').notNull(),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [index('idx_verification_identifier').on(t.identifier)],
);

/**
 * 用户身份表（多对多）：一个账号可以同时是作家与管理员。
 *
 * 为什么是关联表而不是 user.role 一列：身份是「能力集合」而非等级，
 * 「既是作家又是管理员」是真实需求（作者给自己开个管理号很常见）；
 * 单列要么存逗号串（无法索引、无法约束），要么强迫一人开两个账号。
 *
 * 复合主键 (user_id, role) 同时承担去重（同一身份不能重复授予）与按用户查身份的索引；
 * idx_user_role_role 供反向查询用（筛「所有作家」扫的是它）。
 *
 * role 的取值由 common/authz/role.ts 的 zod enum 约束，列只给长度（varchar(16)），
 * 理由见该文件：MySQL ENUM 加值要 ALTER TABLE。
 *
 * reader 也真实落库（所有账号都有），不是「没有记录」——这样「筛读者」与「筛作家」
 * 的查询形状一致，前端也不必区分「空集合」这种特殊语义。
 */
export const userRole = mysqlTable(
  'user_role',
  {
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).notNull(),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] }), index('idx_user_role_role').on(t.role)],
);

/**
 * relations 只为 drizzle 的关系查询（db.query.user.findMany({ with: { session: true } })）
 * 与 better-auth 的 joins 优化准备；当前业务查询仍走显式 join，不依赖它。
 */
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  userRoles: many(userRole),
}));

export const userRoleRelations = relations(userRole, ({ one }) => ({
  user: one(user, { fields: [userRole.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export type UserRow = typeof user.$inferSelect;
export type NewUserRow = typeof user.$inferInsert;
export type SessionRow = typeof session.$inferSelect;
export type NewSessionRow = typeof session.$inferInsert;
export type AccountRow = typeof account.$inferSelect;
export type NewAccountRow = typeof account.$inferInsert;
export type UserRoleRow = typeof userRole.$inferSelect;
export type NewUserRoleRow = typeof userRole.$inferInsert;

export type CrawlSourceRow = typeof crawlSource.$inferSelect;
export type NewCrawlSourceRow = typeof crawlSource.$inferInsert;
export type BookRow = typeof book.$inferSelect;
export type NewBookRow = typeof book.$inferInsert;
export type BookChapterRow = typeof bookChapter.$inferSelect;
export type NewBookChapterRow = typeof bookChapter.$inferInsert;
export type BookContentRow = typeof bookContent.$inferSelect;
export type NewBookContentRow = typeof bookContent.$inferInsert;
