import { z } from 'zod';

import { bookOriginSchema } from '@novel-plus/shared/dto/enums';

/**
 * 书籍后台管理的请求体与响应结构。
 *
 * 请求体（create/metadata/patch/batchDelete）是**运行时真校验**：schema 挂在 controller 的
 * `@Body({ schema })` 上，由 Nest 的 StandardSchemaValidationPipe 执行。
 * 响应结构只用于 OpenAPI 文档与前端类型，不参与校验——所以两者虽然同文件，语义不同。
 *
 * 与查询参数分开放（查询参数留在 server 的 `book.query.schema.ts`）：
 * 查询参数永远来自 URL（全是字符串，需要 coerce），请求体来自 JSON（类型齐全），
 * 两者的校验规则和默认值策略不同，混在一份里容易漏掉 coerce。
 */

/* ------------------------------ 请求体 ------------------------------ */

/**
 * 可编辑的元数据字段（不含 bookUrl / sourceId，那两个决定"这本书是谁"）。
 * 统一 nullable + optional：不传 = 保持/置空由接口语义决定（PUT 置 null，PATCH 保持）。
 *
 * 刻意不含 wordCount / latestChapterTitle / totalChapterNum / authorId：
 * 前三个是采集与章节同步写出来的统计值，第四个是作家端预留的归属关系，
 * 都不由后台请求体指定。它们仍在 `bookSummarySchema` 里返回给列表展示。
 */
const metadataFields = {
  author: z.string().trim().max(255).nullable().optional(),
  coverUrl: z.string().trim().max(512).nullable().optional(),
  intro: z.string().max(65535).nullable().optional(),
};

/** 新增书籍（手动录入用；采集写入不走这里）。bookUrl/sourceId 可空（手动导入的书无源站地址/书源） */
export const createBookSchema = z.object({
  name: z.string().trim().min(1, '书名不能为空').max(255),
  bookUrl: z.string().trim().min(1, '书籍 URL 不能为空').max(512).nullish(),
  sourceId: z.coerce.number().int().positive('sourceId 必须是正整数').nullish(),
  tocUrl: z.string().trim().max(512).nullable().optional(),
  /**
   * 入库方式：crawl（爬虫采集）/ author（作家上传）/ manual（手动导入）。
   * 不传时默认 manual——从后台手动录入的书就是「手动导入」。
   */
  origin: bookOriginSchema.optional(),
  ...metadataFields,
});

export type CreateBookInput = z.infer<typeof createBookSchema>;

/**
 * 全量覆盖元数据（PUT）：未传的 author / coverUrl / intro 会被置 null；origin 不传表示「不改」。
 *
 * 统计值与归属不在请求体里，PUT 也不会碰它们——否则一次元数据保存就会把采集结果清空。
 * zod 的 object 默认 strip 未知键，老客户端多传这些字段会被静默忽略，而不是报 400。
 */
export const bookMetadataSchema = z.object({
  name: z.string().trim().min(1, '书名不能为空').max(255),
  /**
   * 入库方式：不传 = 不改。刻意不跟 PUT 的「未传即置空」语义——
   * 一次元数据全量保存把渠道改回默认值，会让「按来源统计」的口径悄悄出错。
   */
  origin: bookOriginSchema.optional(),
  ...metadataFields,
});

export type BookMetadataInput = z.infer<typeof bookMetadataSchema>;

/**
 * 部分更新元数据（PATCH）：字段不传 = 不改，传 null = 清空。
 * 例如只改简介：{ intro: "..." }，其余字段原样保留。
 * 采集统计值与归属同样不在请求体内，无法通过 PATCH 修改。
 */
export const bookMetadataPatchSchema = bookMetadataSchema.partial();

export type BookMetadataPatch = z.infer<typeof bookMetadataPatchSchema>;

/** 批量删除书籍 */
export const batchDeleteBookSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'ids 不能为空').max(200, '单次最多删除 200 本书'),
});

export type BatchDeleteBookInput = z.infer<typeof batchDeleteBookSchema>;

/* ------------------------------ 响应体 ------------------------------ */

/** MySQL datetime 序列化成 JSON 后是 ISO 8601 字符串，不是 Date 对象 */
const dateTime = z.string().describe('ISO 8601 时间字符串');

/** 列表/详情行：book 字段 + 书源名 + 已采集章节数 */
export const bookSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  author: z.string().nullable(),
  coverUrl: z.string().nullable(),
  bookUrl: z.string().nullable().describe('源站书籍地址；手动导入的书为 null'),
  sourceId: z.number().int().nullable(),
  sourceName: z.string().nullable().describe('书源名；书源被删后为 null'),
  wordCount: z.string().nullable(),
  latestChapterTitle: z.string().nullable(),
  totalChapterNum: z.number().int().nullable(),
  tocUrl: z.string().nullable(),
  intro: z.string().nullable(),
  origin: bookOriginSchema.describe('入库方式：crawl 爬虫采集 / author 作家上传 / manual 手动导入'),
  authorId: z.string().nullable().describe('归属作家账号 id；null 表示无主（不属于任何账号）'),
  authorName: z.string().nullable().describe('归属作家的账号昵称；无主或账号已删时为 null'),
  chapterCount: z.number().int().describe('实际落库的章节数'),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export type BookSummary = z.infer<typeof bookSummarySchema>;

export const bookListResponseSchema = z.object({
  list: z.array(bookSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type BookListResponse = z.infer<typeof bookListResponseSchema>;
