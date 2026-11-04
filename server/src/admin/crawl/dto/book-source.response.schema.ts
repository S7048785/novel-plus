import { z } from 'zod';

/**
 * 书源接口的**响应**结构（仅用于 OpenAPI 文档与前端 codegen，不参与校验）。
 *
 * 规则体在 DB 里是 json 一列，字段随 reader 规范增补，所以这里用 looseObject
 * （未声明的键会被保留而不是剥掉），避免书源新增字段后前端类型对不上。
 */

const dateTime = z.string().describe('ISO 8601 时间字符串');

/** 搜索结果规则（explore 复用同一形状） */
const searchRuleSchema = z.looseObject({
  checkKeyWord: z.string().optional(),
  bookList: z.string().optional(),
  name: z.string().optional(),
  author: z.string().optional(),
  intro: z.string().optional(),
  kind: z.string().optional(),
  lastChapter: z.string().optional(),
  updateTime: z.string().optional(),
  bookUrl: z.string().optional(),
  coverUrl: z.string().optional(),
  wordCount: z.string().optional(),
});

const bookInfoRuleSchema = z.looseObject({
  init: z.string().optional(),
  name: z.string().optional(),
  author: z.string().optional(),
  intro: z.string().optional(),
  kind: z.string().optional(),
  lastChapter: z.string().optional(),
  updateTime: z.string().optional(),
  coverUrl: z.string().optional(),
  wordCount: z.string().optional(),
  tocUrl: z.string().optional(),
  canReName: z.string().optional(),
  downloadUrls: z.string().optional(),
});

const tocRuleSchema = z.looseObject({
  preUpdateJs: z.string().optional(),
  init: z.string().optional(),
  chapterList: z.string().optional(),
  chapterName: z.string().optional(),
  chapterUrl: z.string().optional(),
  formatJs: z.string().optional(),
  isVolume: z.string().optional(),
  updateTime: z.string().optional(),
  nextTocUrl: z.string().optional(),
});

const contentRuleSchema = z.looseObject({
  content: z.string().optional(),
  title: z.string().optional(),
  nextContentUrl: z.string().optional(),
  webJs: z.string().optional(),
  sourceRegex: z.string().optional(),
  replaceRegex: z.string().optional(),
  imageStyle: z.string().optional(),
  imageDecode: z.string().optional(),
  payAction: z.string().optional(),
});

/** 列表行（不含规则体） */
export const crawlSourceSummarySchema = z.object({
  id: z.number().int(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  enabled: z.boolean(),
  status: z.number().int().describe('0=可用，1=不可用（采集失败时自动标记）'),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const bookSourceListResponseSchema = z.object({
  list: z.array(crawlSourceSummarySchema),
  total: z.number().int(),
});

/** 详情：DB 标量列 + 完整规则体 */
export const bookSourceDetailSchema = z.looseObject({
  id: z.number().int().optional(),
  bookSourceName: z.string(),
  bookSourceGroup: z.string().optional(),
  bookSourceUrl: z.string(),
  bookSourceType: z.number().int().optional(),
  enabled: z.boolean().optional(),
  enabledExplore: z.boolean().optional(),
  charset: z.string().optional().describe('站点编码，默认 utf-8'),
  jsLib: z.string().optional(),
  header: z.string().optional(),
  searchUrl: z.string().optional(),
  exploreUrl: z.string().optional(),
  loginUrl: z.string().optional(),
  ruleSearch: searchRuleSchema.optional(),
  ruleBookInfo: bookInfoRuleSchema.optional(),
  ruleToc: tocRuleSchema.optional(),
  ruleContent: contentRuleSchema.optional(),
  ruleExplore: searchRuleSchema.optional(),
  status: z.number().int().optional(),
});

/** 书源测试结果：ok=false 表示抓取/配置有问题，不是「没搜到」 */
export const sourceTestResponseSchema = z.object({
  ok: z.boolean(),
  costMs: z.number(),
  total: z.number().int(),
  list: z.array(
    z.object({
      name: z.string(),
      author: z.string().nullable(),
      bookUrl: z.string(),
      coverUrl: z.string().optional(),
      intro: z.string().optional(),
      wordCount: z.string().optional(),
    }),
  ),
  error: z.string().optional(),
});
