import { z } from 'zod';

/**
 * 章节后台管理的请求体与响应结构。
 *
 * 路由参数（`bookId` / `chapterId`）与列表查询参数留在 server 的 `chapter.schema.ts`：
 * 它们的职责是「把 URL 上的字符串还原成值」（需要 coerce），前端不消费那一层。
 */

/* ------------------------------ 请求体 ------------------------------ */

/** 新增章节：index 不传则自动追加到目录末尾；url 可选（手动导入的章节无源站地址） */
export const createChapterSchema = z.object({
  title: z.string().trim().min(1, '章节标题不能为空').max(512),
  url: z.string().trim().min(1, '章节地址不能为空').max(512).nullish(),
  index: z.coerce.number().int().min(0).optional(),
  content: z.string().nullable().optional(),
});

export type CreateChapterInput = z.infer<typeof createChapterSchema>;

/**
 * 更新章节（PATCH）：只改传入字段。
 * url 语义：不传 = 不动；null = 清空源站地址；字符串 = 覆盖。
 * content 语义：不传 = 不动正文；null 或空串 = 删除正文；字符串 = 覆盖。
 */
export const updateChapterSchema = z.object({
  title: z.string().trim().min(1, '章节标题不能为空').max(512).optional(),
  url: z.string().trim().min(1, '章节地址不能为空').max(512).nullish(),
  index: z.coerce.number().int().min(0).optional(),
  content: z.string().nullable().optional(),
});

export type UpdateChapterInput = z.infer<typeof updateChapterSchema>;

/** 批量删除章节 */
export const batchDeleteChapterSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'ids 不能为空').max(500, '单次最多删除 500 章'),
});

export type BatchDeleteChapterInput = z.infer<typeof batchDeleteChapterSchema>;

/* ------------------------------ 响应体 ------------------------------ */

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

export type ChapterSummary = z.infer<typeof chapterSummarySchema>;

/** 详情：列表字段 + 正文（Markdown） */
export const chapterDetailSchema = chapterSummarySchema.extend({
  content: z.string().nullable(),
});

export type ChapterDetail = z.infer<typeof chapterDetailSchema>;

export const chapterListResponseSchema = z.object({
  list: z.array(chapterSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type ChapterListResponse = z.infer<typeof chapterListResponseSchema>;
