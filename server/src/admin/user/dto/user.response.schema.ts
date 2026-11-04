import { z } from 'zod';
import { userRoleSchema } from '../../../common/authz/role.js';

/**
 * 用户后台管理的**响应**结构（仅用于 OpenAPI 文档与前端 codegen，不参与校验）。
 *
 * 与 user.payload.schema.ts 分文件的原因同 book.response.schema.ts：
 * 入参 schema 是运行时真校验，响应 schema 只是给文档用的类型描述。
 *
 * 注意这里**不含任何密码/account 字段**：后台看得到「谁能登录」，但看不到凭据本身。
 */

/** MySQL datetime 序列化成 JSON 后是 ISO 8601 字符串，不是 Date 对象 */
const dateTime = z.string().describe('ISO 8601 时间字符串');

export const userSummarySchema = z.object({
  id: z.string().describe('better-auth 生成的 32 位字符串主键'),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean().describe('邮箱是否已验证；当前没有 SMTP，恒为 false'),
  image: z.string().nullable().describe('头像地址'),
  roles: z.array(userRoleSchema).describe('身份集合，至少含 reader；按 reader → author → admin 排序'),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const userListResponseSchema = z.object({
  list: z.array(userSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

// 写接口的信封不能复用 common/dto/common.response.schema.ts —— 那套的 id 是 number（自增主键），
// 用户的主键是字符串，形状不同，强行复用会让前端生成的类型对不上。

/** 新增/更新成功：返回受影响用户的 id */
export const userIdResponseSchema = z.object({ id: z.string() });

/** 单条删除成功 */
export const userDeleteResponseSchema = z.object({
  id: z.string(),
  deleted: z.number().int().describe('实际删除的行数，0 表示记录不存在'),
});

/** 批量删除成功：ids 里不存在的记录会被忽略，不报错 */
export const userBatchDeleteResponseSchema = z.object({
  deleted: z.number().int().describe('实际删除的行数'),
  ids: z.array(z.string()),
});
