import { z } from 'zod';

/**
 * 章节后台管理的**响应**结构（仅用于 OpenAPI 文档与前端 codegen，不参与校验）。
 * 入参校验见 chapter.schema.ts。
 */

const dateTime = z.string().describe('ISO 8601 时间字符串');

/** 列表行：不带正文（一章正文几 KB，整页带上会把响应撑爆） */
export const chapterSummarySchema = z.object({
  id: z.number().int(),
  bookId: z.number().int(),
  title: z.string(),
  url: z.string().nullable().describe('源站章节地址；手动导入的章节为 null'),
  index: z.number().int(),
  contentLength: z.number().int().describe('正文字数（CHAR_LENGTH），无正文为 0'),
  createdAt: dateTime,
  updatedAt: dateTime,
});

/** 详情：列表字段 + 正文（Markdown） */
export const chapterDetailSchema = chapterSummarySchema.extend({
  content: z.string().nullable(),
});

export const chapterListResponseSchema = z.object({
  list: z.array(chapterSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
