import { ApiResponse, type ApiResponseOptions } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * 把 zod schema 转成 OpenAPI 3.0 的 schema 对象。
 *
 * 请求侧（@Body / @Query / @Param 的 schema 选项）不需要它：Nest 12 的 Swagger 模块会
 * 自己读 Standard Schema 的 `~standard.jsonSchema`（zod 4.2+ 实现了该扩展）完成转换。
 *
 * **响应侧必须显式声明**：handler 的返回类型是 TS 类型，编译后不存在，Swagger 无法反射，
 * 不写就只能得到空的 200 响应描述。所以响应结构统一用 zod 定义、在这里转一次，
 * 既是文档来源，也能被前端 codegen 直接消费。
 *
 * io: 'output' 表示按「服务端返回的形状」转换（若 schema 带 transform，取转换后的类型）。
 */
export function toOpenApiSchema(schema: z.ZodType): ResponseSchema {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'output' }) as unknown as ResponseSchema;
}

/**
 * 从 ApiResponseOptions 里取出「带 schema 的那一支」的 schema 类型。
 * ApiResponseOptions = ApiResponseMetadata | ApiResponseSchemaHost，直接写 ['schema'] 会报
 * 「联合类型上不存在该属性」。
 */
type ResponseSchema = NonNullable<Extract<ApiResponseOptions, { schema: unknown }>['schema']>;

/** 声明响应体（类型来自 zod schema）：`@ApiZodResponse(bookListResponseSchema)` 或指定 status */
export function ApiZodResponse(schema: z.ZodType, options: Omit<ApiResponseOptions, 'schema'> = {}) {
  return ApiResponse({ ...options, schema: toOpenApiSchema(schema) });
}

/** 200 响应（查询/更新类接口） */
export function ApiZodOk(schema: z.ZodType, options: Omit<ApiResponseOptions, 'schema'> = {}) {
  return ApiZodResponse(schema, { status: 200, ...options });
}

/** 201 响应（新增资源，Nest 的 POST 默认状态码） */
export function ApiZodCreated(schema: z.ZodType, options: Omit<ApiResponseOptions, 'schema'> = {}) {
  return ApiZodResponse(schema, { status: 201, ...options });
}
