import { z } from 'zod';

/**
 * 用户列表的查询参数（GET /users）。
 *
 * 与请求体分文件的理由同 book.query.schema.ts：查询参数来自 URL（全是字符串，需要 coerce），
 * 请求体来自 JSON（类型齐全），两者的校验规则和默认值策略并不相同。
 */
export const listUserQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, 'pageSize 最大 100').default(20),
  /** 同时匹配昵称与邮箱 */
  keyword: z.string().trim().min(1).optional(),
  /**
   * 身份筛选。语义按身份不同而不同，这里必须说清：
   * - author / admin：持有该身份（含多重身份者）
   * - reader：**只**有读者身份（不含作家、管理员）
   *
   * reader 反着定义是因为它是所有账号的基础身份，按「持有」筛选等于返回全部、没有意义；
   * 真正有用的是「找出还没被授予附加身份的账号」。
   */
  role: z.enum(['reader', 'author', 'admin']).optional(),
});

export type ListUserQuery = z.infer<typeof listUserQuerySchema>;
