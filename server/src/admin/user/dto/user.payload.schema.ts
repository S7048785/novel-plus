import { z } from 'zod';
import { assignableRoleSchema } from '../../../common/authz/role.js';

/**
 * 用户后台管理的请求体 schema（POST / PATCH / batch-delete）。
 *
 * 字段范围刻意收窄：只允许改「展示信息 + 身份」（昵称、邮箱、头像、roles）。
 * - user.id 是 better-auth 生成的主键，改了会让所有会话与 account 行失去归属，绝不暴露
 * - emailVerified 属于验证流程的产物，管理员手改等于伪造「已验证」，不开放
 * - 密码只在建号时设置（本次范围仅基础 CRUD，重置密码留给后续单独接口）
 *
 * roles 里只接受 author / admin：reader 是所有账号的基础身份，由服务端自动补齐，
 * 让客户端来决定「要不要给 reader」只会制造「没有身份的账号」这种非法状态。
 */

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

/**
 * 用户 id 是 better-auth 生成的 32 位字符串（varchar(36)），不是自增数字，
 * 所以不能复用 common/dto/common.schema.ts 里数字型的 idParamsSchema。
 */
export const userIdParamsSchema = z.object({
  id: z.string().trim().min(1, '用户 id 不能为空').max(36, '用户 id 最多 36 字符'),
});

export type UserIdParams = z.infer<typeof userIdParamsSchema>;

export const batchDeleteUserSchema = z.object({
  ids: z
    .array(z.string().trim().min(1).max(36))
    .min(1, 'ids 不能为空')
    .max(200, '单次最多删除 200 个用户'),
});

export type BatchDeleteUserInput = z.infer<typeof batchDeleteUserSchema>;
