import { z } from 'zod';

/**
 * 书籍后台管理的**响应**结构（仅用于 OpenAPI 文档与前端 codegen，不参与校验）。
 *
 * 与 book.payload.schema.ts 分文件的原因：入参 schema 是运行时的真校验（schema 挂在参数
 * 装饰器上被管道执行），响应 schema 纯粹是给文档用的类型描述，混在一起容易让人误以为
 * 返回值也会被校验。
 */

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
  chapterCount: z.number().int().describe('实际落库的章节数'),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const bookListResponseSchema = z.object({
  list: z.array(bookSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

// 写接口的信封（{ id } / { id, deleted } / { deleted, ids }）各资源同形，
// 统一放在 common/dto/common.response.schema.ts，这里不再重复定义。
