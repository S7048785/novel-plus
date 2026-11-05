import { z } from 'zod';

/**
 * 用户的路由参数 schema。
 *
 * 用户 id 是 better-auth 生成的 32 位字符串（varchar(36)），不是自增数字，
 * 所以不能复用 common/dto/common.schema.ts 里数字型的 idParamsSchema。
 *
 * 请求体与响应结构在 `@novel-plus/shared/dto`。
 */

export const userIdParamsSchema = z.object({
  id: z.string().trim().min(1, '用户 id 不能为空').max(36, '用户 id 最多 36 字符'),
});

export type UserIdParams = z.infer<typeof userIdParamsSchema>;
