import { z } from 'zod';

// id 参数 schema 所有资源通用，定义在 common.schema.ts；这里 re-export 保持原有引用路径可用
export { idParamsSchema, idSchema } from '../../../common/dto/common.schema.js';

/**
 * 书源相关接口的入参 schema。
 *
 * 配合 Nest 12 内置的 StandardSchemaValidationPipe 使用：schema 挂在参数装饰器上，
 * 例如 `@Body({ schema: bookSourceSchema })`，管道在参数绑定阶段完成校验 + 类型收窄。
 */

/**
 * 书源配置体。
 *
 * 用 looseObject 而非 object：书源规则字段（ruleSearch/ruleBookInfo/ruleToc/ruleContent/jsLib/header/
 * exploreUrl 等）有二十来个且会随 reader 规范增补，逐字段声明既没必要，又会被 z.object 默认的
 * 「剥离未知键」行为静默吃掉——那等于用户存的规则入库后消失。这里只校验真正参与入库与查询的标量字段。
 */
export const bookSourceSchema = z.looseObject({
  bookSourceName: z.string().trim().min(1, '书源名称不能为空').max(255, '书源名称最长 255 字符'),
  bookSourceUrl: z.string().trim().min(1, '书源地址不能为空').max(512, '书源地址最长 512 字符'),
  bookSourceGroup: z.string().max(255).optional(),
  bookSourceType: z.number().int().optional(),
  charset: z.string().max(32).optional(),
  enabled: z.boolean().optional(),
});

export type BookSourceInput = z.infer<typeof bookSourceSchema>;

/**
 * 部分更新体：字段全部可选，只传要改的。
 * 典型用途：列表页的启用/停用开关只传 { enabled: false }，不该连带清掉规则体。
 */
export const bookSourcePatchSchema = z.looseObject({
  bookSourceName: z.string().trim().min(1, '书源名称不能为空').max(255).optional(),
  bookSourceUrl: z.string().trim().min(1, '书源地址不能为空').max(512).optional(),
  bookSourceGroup: z.string().max(255).optional(),
  bookSourceType: z.number().int().optional(),
  charset: z.string().max(32).optional(),
  enabled: z.boolean().optional(),
});

export type BookSourcePatch = z.infer<typeof bookSourcePatchSchema>;

/** 列表筛选：keyword 同时匹配名称与地址；enabled 只接受 'true'/'false' 字符串 */
export const listSourceQuerySchema = z.object({
  keyword: z.string().trim().min(1).optional(),
  enabled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type ListSourceQuery = z.infer<typeof listSourceQuerySchema>;

/** 批量删除：ids 非空且有上限，避免一条请求删库 */
export const batchDeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'ids 不能为空').max(200, '单次最多删除 200 个书源'),
});

export type BatchDeleteInput = z.infer<typeof batchDeleteSchema>;

/** 测试书源：用关键词跑一次搜索 */
export const testSourceSchema = z.object({
  key: z.string().trim().min(1, '测试关键词不能为空').max(100),
  page: z.coerce.number().int().min(1).max(50).optional(),
});

export type TestSourceInput = z.infer<typeof testSourceSchema>;
