import { z } from 'zod';

/**
 * 章节后台管理的入参 schema。
 * 章节挂在书下面，路由为 /book/:bookId/chapter，所以路径参数里书 id 与章节 id 成对出现。
 */

const idField = z.coerce.number().int().positive();

/** 路由参数：/book/:bookId/chapter */
export const bookIdParamsSchema = z.object({ bookId: idField });

/** 路由参数：/book/:bookId/chapter/:chapterId */
export const chapterParamsSchema = z.object({ bookId: idField, chapterId: idField });

export type BookIdParams = z.infer<typeof bookIdParamsSchema>;
export type ChapterParams = z.infer<typeof chapterParamsSchema>;

/** 列表查询：章节多的书可能上千章，必须分页；pageSize 上限放宽到 200（目录页常见） */
export const listChapterQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200, 'pageSize 最大 200').default(50),
});

export type ListChapterQuery = z.infer<typeof listChapterQuerySchema>;

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
