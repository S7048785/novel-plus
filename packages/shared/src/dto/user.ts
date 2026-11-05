import { z } from 'zod';

import { assignableRoleSchema, userRoleSchema } from '@novel-plus/shared/dto/enums';

/**
 * 用户后台管理的请求体与响应结构。
 *
 * 请求体字段范围刻意收窄：只允许改「展示信息 + 身份」（昵称、邮箱、头像、roles）。
 * - user.id 是 better-auth 生成的主键，改了会让所有会话与 account 行失去归属，绝不暴露
 * - emailVerified 属于验证流程的产物，管理员手改等于伪造「已验证」，不开放
 * - 密码只在建号时设置（本次范围仅基础 CRUD，重置密码留给后续单独接口）
 *
 * 用户 id 的**路由参数** schema（`userIdParamsSchema`）留在 server：那是把 URL 段还原成值的适配层。
 */

/* ------------------------------ 请求体 ------------------------------ */

/**
 * 密码规则必须与 auth.config.ts 的 emailAndPassword.minPasswordLength / maxPasswordLength 对齐：
 * 后台能建出 3 位密码的号，登录端却卡 8 位，会造成「建得出、登不上」的死角。
 */
const passwordSchema = z.string().min(8, '密码至少 8 位').max(64, '密码最多 64 位');

/** 不做 trim：邮箱前后空格在 service 层统一剥掉并小写化，schema 只负责格式 */
const emailSchema = z.email('邮箱格式不正确').max(255, '邮箱最多 255 字符');

/** better-auth 的 image 列是 text，这里按 URL/路径的实际使用场景给一个宽松上限 */
const imageSchema = z.string().max(2048, '头像地址最多 2048 字符');

/** 附加值身份（不含 reader）；去重后最多两个，天然不会出现重复行 */
const rolesSchema = z.array(assignableRoleSchema).max(2, '身份最多两个');

export const createUserSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1, '昵称不能为空').max(255, '昵称最多 255 字符'),
  password: passwordSchema,
  image: imageSchema.nullish(),
  /** 不传 = 只有读者身份 */
  roles: rolesSchema.optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * 部分更新：不传 = 不改，image 传 null = 清空头像。
 *
 * 只提供 PATCH、不额外提供 PUT 的理由：可编辑字段很少且都能表达「不传即不改」；
 * 再加一个 PUT（未传即置空）会引入两套语义，同一份表单要维护两种提交路径，收益为零。
 *
 * roles 是「整体替换」而非增量：传 ['author'] 表示最终身份是 读者 + 作家，
 * 不传表示不动身份。增量语义（加一个/删一个）在 UI 上是复选框，本来就该整体提交。
 */
export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  name: z.string().trim().min(1, '昵称不能为空').max(255, '昵称最多 255 字符').optional(),
  image: imageSchema.nullable().optional(),
  roles: rolesSchema.optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const batchDeleteUserSchema = z.object({
  ids: z
    .array(z.string().trim().min(1).max(36))
    .min(1, 'ids 不能为空')
    .max(200, '单次最多删除 200 个用户'),
});

export type BatchDeleteUserInput = z.infer<typeof batchDeleteUserSchema>;

/* ------------------------------ 响应体 ------------------------------ */

/** MySQL datetime 序列化成 JSON 后是 ISO 8601 字符串，不是 Date 对象 */
const dateTime = z.string().describe('ISO 8601 时间字符串');

/** 注意这里**不含任何密码/account 字段**：后台看得到「谁能登录」，但看不到凭据本身。 */
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

export type UserSummary = z.infer<typeof userSummarySchema>;

export const userListResponseSchema = z.object({
  list: z.array(userSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type UserListResponse = z.infer<typeof userListResponseSchema>;

// 写接口的信封不能复用 common.ts —— 那套的 id 是 number（自增主键），用户的 id 是字符串，
// 形状不同，强行复用会让前端拿到的类型对不上。

/** 新增/更新成功：返回受影响用户的 id */
export const userIdResponseSchema = z.object({ id: z.string() });

export type UserIdResponse = z.infer<typeof userIdResponseSchema>;

/** 单条删除成功 */
export const userDeleteResponseSchema = z.object({
  id: z.string(),
  deleted: z.number().int().describe('实际删除的行数，0 表示记录不存在'),
});

export type UserDeleteResponse = z.infer<typeof userDeleteResponseSchema>;

/** 批量删除成功：ids 里不存在的记录会被忽略，不报错 */
export const userBatchDeleteResponseSchema = z.object({
  deleted: z.number().int().describe('实际删除的行数'),
  ids: z.array(z.string()),
});

export type UserBatchDeleteResponse = z.infer<typeof userBatchDeleteResponseSchema>;
