import { z } from 'zod';

/**
 * 书籍后台管理的请求体 schema（POST / PUT / PATCH / batch-delete）。
 *
 * 与查询参数分文件（book.query.schema.ts）：这里不做 coerce，只约束 JSON 结构。
 */

/**
 * 可编辑的元数据字段（不含 bookUrl / sourceId，那两个决定"这本书是谁"）。
 * 统一 nullable + optional：不传 = 保持/置空由接口语义决定（PUT 置空，PATCH 保持）。
 */
const metadataFields = {
  author: z.string().trim().max(255).nullable().optional(),
  coverUrl: z.string().trim().max(512).nullable().optional(),
  intro: z.string().max(65535).nullable().optional(),
  kind: z.string().trim().max(255).nullable().optional(),
  wordCount: z.string().trim().max(64).nullable().optional(),
  latestChapterTitle: z.string().trim().max(255).nullable().optional(),
  totalChapterNum: z.coerce.number().int().min(0).nullable().optional(),
  updateTime: z.string().trim().max(64).nullable().optional(),
};

/** 新增书籍（手动录入用；采集写入不走这里）。bookUrl/sourceId 可空（手动导入的书无源站地址/书源） */
export const createBookSchema = z.object({
  name: z.string().trim().min(1, '书名不能为空').max(255),
  bookUrl: z.string().trim().min(1, '书籍 URL 不能为空').max(512).nullish(),
  sourceId: z.coerce.number().int().positive('sourceId 必须是正整数').nullish(),
  tocUrl: z.string().trim().max(512).nullable().optional(),
  ...metadataFields,
});

export type CreateBookInput = z.infer<typeof createBookSchema>;

/** 全量覆盖元数据（PUT）：未传的元数据字段会被置 null */
export const bookMetadataSchema = z.object({
  name: z.string().trim().min(1, '书名不能为空').max(255),
  ...metadataFields,
});

export type BookMetadataInput = z.infer<typeof bookMetadataSchema>;

/**
 * 部分更新元数据（PATCH）：字段不传 = 不改，传 null = 清空。
 * 例如只改简介：{ intro: "..." }，其余字段原样保留。
 */
export const bookMetadataPatchSchema = bookMetadataSchema.partial();

export type BookMetadataPatch = z.infer<typeof bookMetadataPatchSchema>;

/** 批量删除书籍 */
export const batchDeleteBookSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'ids 不能为空').max(200, '单次最多删除 200 本书'),
});

export type BatchDeleteBookInput = z.infer<typeof batchDeleteBookSchema>;
