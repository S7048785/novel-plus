import { z } from 'zod';
import { bookOriginSchema } from '../../../common/book/origin.js';

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
  wordCount: z.string().trim().max(64).nullable().optional(),
  latestChapterTitle: z.string().trim().max(255).nullable().optional(),
  totalChapterNum: z.coerce.number().int().min(0).nullable().optional(),
};

/**
 * 归属作家账号（user.id）。
 *
 * 长度 36 是 user.id 的上限（better-auth 现在是 32 位，留点余量）。
 * 存在性与身份（必须持有 author）由 service 校验——schema 只管形状，
 * 查库的事放进 service 才能给出「账号不存在」「该账号不是作家」这种可读错误。
 */
const authorIdSchema = z.string().trim().min(1, 'authorId 不能为空').max(36);

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
  /** 归属作家账号；不传 = 无主（采集/手动导入的书通常没有归属） */
  authorId: authorIdSchema.nullish(),
  ...metadataFields,
});

export type CreateBookInput = z.infer<typeof createBookSchema>;

/** 全量覆盖元数据（PUT）：未传的元数据字段会被置 null；origin 例外，不传表示「不改」 */
export const bookMetadataSchema = z.object({
  name: z.string().trim().min(1, '书名不能为空').max(255),
  /**
   * 入库方式：不传 = 不改。刻意不跟 PUT 的「未传即置空」语义——
   * 一次元数据全量保存把渠道改回默认值，会让「按来源统计」的口径悄悄出错。
   */
  origin: bookOriginSchema.optional(),
  /**
   * 归属作家：不传 = 不改，传 null = 清空归属。
   *
   * 跟 origin 一样不吃 PUT 的「未传即置空」语义：一次元数据全量保存就把书变成无主，
   * 会让作家端后台里那本书凭空消失，比少传字段难查得多。转移归属是个明确动作，应当显式提交。
   */
  authorId: authorIdSchema.nullable().optional(),
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
