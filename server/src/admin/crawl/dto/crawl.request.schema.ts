import { z } from 'zod';

/**
 * 采集接口的**查询参数**。
 *
 * 请求体（单本采集、规则试跑）与响应结构都在 `@novel-plus/shared/dto`——
 * 前端要用同一份类型描述请求与响应。留在这里的是从 URL 取值的部分，需要 coerce。
 */

/** 搜索：书源 + 关键词 + 页码 */
export const searchQuerySchema = z.object({
  sourceId: z.coerce.number().int().positive('sourceId 必须是正整数'),
  key: z.string().trim().min(1, '搜索关键词不能为空').max(100, '关键词最长 100 字符'),
  page: z.coerce.number().int().min(1).max(50).default(1),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
