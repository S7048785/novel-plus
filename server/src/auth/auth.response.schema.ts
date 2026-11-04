import { z } from 'zod';
import { userRoleSchema } from '../common/authz/role.js';

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
 * 当前登录用户 + 身份。
 *
 * 未登录时 user 为 null、roles 为空数组（而不是 401）：前端判断登录态时看这个字段更省事。
 *
 * roles 不并进 user 对象：它不来自 user 表（是 user_role 关联表 join 出来的），
 * 与 better-auth 的 session.user 形状不同；放在同级能让「会话给的原始用户」与
 * 「本系统的权限视角」界限清楚。
 */
export const meResponseSchema = z.object({
  user: sessionUserSchema.nullable(),
  roles: z.array(userRoleSchema).describe('用户的身份集合；未登录为空数组'),
});
