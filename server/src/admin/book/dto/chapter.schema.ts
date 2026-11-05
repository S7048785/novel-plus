import { z } from 'zod';

/**
 * 章节的**路由参数**与**列表查询** schema。
 *
 * 请求体（创建 / 更新 / 批量删除）与响应结构都在 `@novel-plus/shared/dto`——前端要用同一份类型。
 * 留在这里的这两类有个共同点：职责是「把 URL 上的字符串还原成值」（coerce / default），
 * 前端手里已经是强类型，不需要这一层。章节挂在书下面，所以路径参数里书 id 与章节 id 成对出现。
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
