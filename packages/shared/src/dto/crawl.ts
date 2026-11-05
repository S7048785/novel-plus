import { z } from 'zod';

/**
 * 采集模块的请求体与响应结构。
 *
 * 查询参数（`searchQuerySchema` / `listSourceQuerySchema` / `bookDetailQuerySchema`）留在 server：
 * 它们负责把 URL 上的字符串还原成值（含 `'true'/'false'` → boolean 的 transform），
 * 前端手里已经是强类型值，不需要这一层。
 */

/* ------------------------------ 请求体 ------------------------------ */

/**
 * 书源配置体。
 *
 * 用 looseObject 而非 object：书源规则字段（ruleSearch/ruleBookInfo/ruleToc/ruleContent/jsLib/header/
 * exploreUrl 等）有二十来个且会随 reader 规范增补，逐字段声明既没必要，又会被 z.object 默认的
 * 「剥离未知键」行为静默吃掉——那等于用户存的规则入库后消失。这里只校验真正参与入库与查询的标量字段。
 */
export const bookSourceSchema = z.looseObject({
  bookSourceName: z.string().trim().min(1, '书源名称不能为空').max(255, '书源名称最长 255 字符'),
  bookSourceUrl: z.string().trim().min(1, '书源地址不能为空').max(512, '书源地址最长 512 字符'),
  bookSourceGroup: z.string().max(255).optional(),
  bookSourceType: z.number().int().optional(),
  charset: z.string().max(32).optional(),
  enabled: z.boolean().optional(),
});

export type BookSourceInput = z.infer<typeof bookSourceSchema>;

/**
 * 部分更新体：字段全部可选，只传要改的。
 * 典型用途：列表页的启用/停用开关只传 { enabled: false }，不该连带清掉规则体。
 */
export const bookSourcePatchSchema = z.looseObject({
  bookSourceName: z.string().trim().min(1, '书源名称不能为空').max(255).optional(),
  bookSourceUrl: z.string().trim().min(1, '书源地址不能为空').max(512).optional(),
  bookSourceGroup: z.string().max(255).optional(),
  bookSourceType: z.number().int().optional(),
  charset: z.string().max(32).optional(),
  enabled: z.boolean().optional(),
});

export type BookSourcePatch = z.infer<typeof bookSourcePatchSchema>;

/** 批量删除书源：ids 非空且有上限，避免一条请求删库 */
export const batchDeleteSourceSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'ids 不能为空').max(200, '单次最多删除 200 个书源'),
});

export type BatchDeleteSourceInput = z.infer<typeof batchDeleteSourceSchema>;

/** 测试书源：用关键词跑一次搜索 */
export const testSourceSchema = z.object({
  key: z.string().trim().min(1, '测试关键词不能为空').max(100),
  page: z.coerce.number().int().min(1).max(50).optional(),
});

export type TestSourceInput = z.infer<typeof testSourceSchema>;

/** 单本采集：maxChapters 不传表示采全书目录 */
export const crawlBookBodySchema = z.object({
  sourceId: z.coerce.number().int().positive('sourceId 必须是正整数'),
  bookUrl: z.string().trim().min(1, 'bookUrl 不能为空').max(1024, 'bookUrl 过长'),
  maxChapters: z.coerce.number().int().min(1).max(20000).optional(),
});

export type CrawlBookBody = z.infer<typeof crawlBookBodySchema>;

/** 规则试跑：把规则作用在一段 HTML 上，返回解析结果 */
export const testRuleBodySchema = z.object({
  rule: z.string().min(1, 'rule 不能为空'),
  content: z.string(),
  baseUrl: z.string().optional(),
});

export type TestRuleBody = z.infer<typeof testRuleBodySchema>;

/* ------------------------------ 响应体 ------------------------------ */

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

/** 书源列表行（不含规则体） */
export const crawlSourceSummarySchema = z.object({
  id: z.number().int(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  enabled: z.boolean(),
  status: z.number().int().describe('0=可用，1=不可用（采集失败时自动标记）'),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export type CrawlSourceSummary = z.infer<typeof crawlSourceSummarySchema>;

export const bookSourceListResponseSchema = z.object({
  list: z.array(crawlSourceSummarySchema),
  total: z.number().int(),
});

export type BookSourceListResponse = z.infer<typeof bookSourceListResponseSchema>;

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

export type BookSourceDetail = z.infer<typeof bookSourceDetailSchema>;

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

export type SourceTestResponse = z.infer<typeof sourceTestResponseSchema>;

/** 搜索结果条目 */
export const searchResultSchema = z.object({
  name: z.string(),
  author: z.string().nullable(),
  bookUrl: z.string(),
  coverUrl: z.string().optional(),
  intro: z.string().optional(),
  wordCount: z.string().optional(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({ list: z.array(searchResultSchema) });

export type SearchResponse = z.infer<typeof searchResponseSchema>;

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

export type BookDetail = z.infer<typeof bookDetailSchema>;

/** 单本采集结果 */
export const crawlBookResponseSchema = z.object({
  bookId: z.number().int(),
  chapterCount: z.number().int().describe('本次实际写入的章节数（已入库的会被跳过）'),
});

export type CrawlBookResponse = z.infer<typeof crawlBookResponseSchema>;

/** 规则试跑结果：解析出的字段结构取决于规则，这里只保证外层信封 */
export const testRuleResponseSchema = z.object({
  result: z.unknown().describe('规则解析结果，形状取决于规则本身'),
});

export type TestRuleResponse = z.infer<typeof testRuleResponseSchema>;
