import { z } from 'zod';

/**
 * 采集接口的**响应**结构（仅用于 OpenAPI 文档与前端 codegen，不参与校验）。
 *
 * 对应 crawl.service.ts 里的 SearchResult / BookDetail 等接口类型，
 * 改动 service 的返回结构时记得同步这里，否则前端生成的类型会与真实响应漂移。
 */

/** 搜索结果条目 */
export const searchResultSchema = z.object({
  name: z.string(),
  author: z.string().nullable(),
  bookUrl: z.string(),
  coverUrl: z.string().optional(),
  intro: z.string().optional(),
  wordCount: z.string().optional(),
});

export const searchResponseSchema = z.object({ list: z.array(searchResultSchema) });

/** 书籍详情（详情页解析结果，不落库）：缺失字段统一给 null，保证结构稳定 */
export const bookDetailSchema = z.object({
  name: z.string(),
  author: z.string().nullable(),
  coverUrl: z.string().nullable(),
  intro: z.string().nullable(),
  wordCount: z.string().nullable(),
  lastChapter: z.string().nullable(),
  tocUrl: z.string().describe('目录页 URL；书源未配 ruleBookInfo.tocUrl 时回落到详情页，故不为 null'),
});

/** 单本采集结果 */
export const crawlBookResponseSchema = z.object({
  bookId: z.number().int(),
  chapterCount: z.number().int().describe('本次实际写入的章节数（已入库的会被跳过）'),
});

/** 规则试跑结果：解析出的字段结构取决于规则，这里只保证外层信封 */
export const testRuleResponseSchema = z.object({
  result: z.unknown().describe('规则解析结果，形状取决于规则本身'),
});
