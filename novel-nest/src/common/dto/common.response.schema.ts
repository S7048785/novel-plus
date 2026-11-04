import { z } from 'zod';

/**
 * 多个模块共用的响应信封（仅用于 OpenAPI 文档与前端 codegen，不参与校验）。
 *
 * 后台的写接口返回结构高度一致，集中在这里，避免每个资源各写一份同形状的 schema
 * 导致前端生成的类型彼此不兼容。
 */

/** 新增/更新成功：返回受影响资源的 id */
export const idResponseSchema = z.object({ id: z.number().int() });

/** 单条删除成功 */
export const deleteResponseSchema = z.object({
  id: z.number().int(),
  deleted: z.number().int().describe('实际删除的行数，0 表示记录不存在'),
});

/** 批量删除成功：ids 里不存在的记录会被忽略，不报错 */
export const batchDeleteResponseSchema = z.object({
  deleted: z.number().int().describe('实际删除的行数'),
  ids: z.array(z.number().int()),
});
