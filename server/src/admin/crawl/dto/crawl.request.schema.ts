import { z } from 'zod';

/**
 * 采集接口的入参 schema。
 *
 * 这里补的是原先直接用 TS 类型手写 body 的端点（search / crawl book / test rule）——
 * 没有运行时校验，也没有 OpenAPI 元数据。改成 zod 后由全局 StandardSchemaValidationPipe
 * 校验，Swagger 也能自动反射出参数与请求体。
 */

/** 搜索：书源 + 关键词 + 页码 */
export const searchQuerySchema = z.object({
  sourceId: z.coerce.number().int().positive('sourceId 必须是正整数'),
  key: z.string().trim().min(1, '搜索关键词不能为空').max(100, '关键词最长 100 字符'),
  page: z.coerce.number().int().min(1).max(50).default(1),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

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
