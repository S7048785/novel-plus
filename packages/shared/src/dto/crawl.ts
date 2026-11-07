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
  charset: z.string().max(32).optional(),
  enabled: z.boolean().optional(),
  /** 备注（DB 标量列，与 json 规则配置无关）；不传表示清空 */
  comment: z.string().trim().max(512, '备注最长 512 字符').optional(),
});

export type BookSourceInput = z.infer<typeof bookSourceSchema>;

/**
 * 部分更新体：字段全部可选，只传要改的。
 * 典型用途：列表页的启用/停用开关只传 { enabled: false }，不该连带清掉规则体。
 */
export const bookSourcePatchSchema = z.looseObject({
  bookSourceName: z.string().trim().min(1, '书源名称不能为空').max(255).optional(),
  bookSourceUrl: z.string().trim().min(1, '书源地址不能为空').max(512).optional(),
  charset: z.string().max(32).optional(),
  enabled: z.boolean().optional(),
  comment: z.string().trim().max(512, '备注最长 512 字符').optional(),
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

/**
 * 测试站点是否可访问（新增书源时先确认地址打得开，再谈规则）。
 *
 * 与 testSourceSchema 的区别：那个校验的是「规则写对没写对」（要书源已存在、要有 searchUrl），
 * 这个只校验「这个地址现在能不能打开」——新增时还没有 id，没有规则，也能先探一次。
 *
 * 地址强制带协议：只写 `www.example.com` 时 fetch 会失败，让人摸不着头脑；
 * 与其在后端猜着补 https://，不如在这里明确告诉调用方缺协议。
 */
export const probeSourceSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, '站点地址不能为空')
    .max(512, '站点地址最长 512 字符')
    .refine((v) => /^https?:\/\//i.test(v), '站点地址需以 http:// 或 https:// 开头'),
  /** 站点编码；探测时用于正确解码标题（gbk 站点不传会得到乱码标题） */
  charset: z.string().trim().max(32).optional(),
});

export type ProbeSourceInput = z.infer<typeof probeSourceSchema>;

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
  comment: z.string().nullable().describe('备注，用户手动维护'),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export type CrawlSourceSummary = z.infer<typeof crawlSourceSummarySchema>;

/**
 * 书源列表响应：分页结构与 bookListResponseSchema / 用户列表保持一致。
 *
 * total 是**满足筛选条件的总行数**（不是当前页条数）——前端分页器要靠它算页数。
 * 早先这里返回 total=list.length，只是把当页条数回显了一遍，翻页器永远只有一页。
 */
export const bookSourceListResponseSchema = z.object({
  list: z.array(crawlSourceSummarySchema),
  total: z.number().int().describe('满足筛选条件的总行数'),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type BookSourceListResponse = z.infer<typeof bookSourceListResponseSchema>;

/** 详情：DB 标量列 + 完整规则体 */
export const bookSourceDetailSchema = z.looseObject({
  id: z.number().int().optional(),
  bookSourceName: z.string(),
  bookSourceUrl: z.string(),
  enabled: z.boolean().optional(),
  enabledExplore: z.boolean().optional(),
  /** 备注（DB 标量列），可空 */
  comment: z.string().nullable().optional(),
  charset: z.string().optional().describe('站点编码，默认 utf-8；gbk 站点必填，否则正文与搜索关键词都会乱码'),
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

/**
 * 站点可达性探测结果。
 *
 * 只如实上报，不在这里判「好坏」：200 + 30 字节的验证码页和 200 + 200KB 的正文页
 * 都算 ok=true，区别要靠 bodyBytes / title 让管理员自己看（前端据此给提示）。
 */
export const sourceProbeResponseSchema = z.object({
  ok: z.boolean().describe('最终响应是否 2xx（3xx 已被跟随）'),
  status: z.number().int().describe('HTTP 状态码；0 表示请求没到达（DNS/超时/证书）'),
  costMs: z.number(),
  finalUrl: z.string().describe('跟随重定向后的最终地址'),
  contentType: z.string().optional(),
  bodyBytes: z.number().int().describe('响应体字节数，用于识别空壳页'),
  charset: z.string().describe('实际用于解码的编码'),
  title: z.string().optional().describe('页面标题，验证码页往往一眼可辨'),
  cookieRetried: z.boolean().optional().describe('首次 403 且下发 cookie 时，带 cookie 重试是否成功'),
  error: z.string().optional().describe('status=0 时的原因'),
});

export type SourceProbeResponse = z.infer<typeof sourceProbeResponseSchema>;

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
