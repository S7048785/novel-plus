import { z } from 'zod';

/**
 * 鉴权接口的**响应**结构（仅用于 OpenAPI 文档与前端 codegen，不参与校验）。
 *
 * 结构对齐 better-auth 的 `session.user`（见 db/schema.ts 的 user 表）：
 * id 是 36 位随机字符串而不是自增数字，头像字段叫 image 而非 avatar。
 */

export const sessionUserSchema = z.object({
  id: z.string().describe('better-auth 生成的字符串 id，不是自增数字'),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable().describe('头像地址，未设置为 null'),
  createdAt: z.string().describe('ISO 8601 时间字符串'),
  updatedAt: z.string().describe('ISO 8601 时间字符串'),
});

/**
 * 当前登录用户。
 *
 * 未登录时 user 为 null（而不是 401）：前端判断登录态时看这个字段更省事，
 * 需要严格 401 的场景另外配守卫。
 */
export const meResponseSchema = z.object({ user: sessionUserSchema.nullable() });
