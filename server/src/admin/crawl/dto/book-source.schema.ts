import { z } from 'zod';

// id 参数 schema 所有资源通用，定义在 common.schema.ts；这里 re-export 保持原有引用路径可用
export { idParamsSchema, idSchema } from '../../../common/dto/common.schema.js';

/**
 * 书源的**查询参数**。
 *
 * 请求体（新增 / 更新 / 批量删除 / 测试）与响应结构都在 `@novel-plus/shared/dto`。
 * 这里留下的是从 URL 取值的部分——`enabled` 在 URL 里只能是 'true'/'false' 字符串，
 * 需要 transform 成 boolean，前端手里已经是布尔值，不消费这层。
 */

/** 列表筛选：keyword 同时匹配名称与地址；enabled 只接受 'true'/'false' 字符串 */
export const listSourceQuerySchema = z.object({
  keyword: z.string().trim().min(1).optional(),
  enabled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type ListSourceQuery = z.infer<typeof listSourceQuerySchema>;
