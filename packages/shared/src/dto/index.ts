/**
 * 接口 schema 的统一入口。
 *
 * 前端只用 `import type { BookSummary } from '@novel-plus/shared/dto'`——类型导入在编译时被擦除，
 * zod 不会进前端产物。真要在前端跑校验（`schema.safeParse`）才会把 zod 打进 bundle，
 * 那时 admin 的 zod 要从 devDependencies 挪到 dependencies。
 *
 * 后端（server）用这里的 schema 做运行时校验与 OpenAPI 文档：
 * schema 挂在 controller 的 `@Body({ schema })` / `@ApiZodOk(schema)` 上，
 * 由 Nest 的 StandardSchemaValidationPipe 与 Swagger 模块消费。
 *
 * 为什么不放在一个文件里：schema 按资源分组，一个文件会长到几百行；分多文件的代价只是多几行 re-export。
 *
 * 注意这里用**包名**互相引用而不是 `./xxx.js` / `./xxx.ts`：shared 是源码直出、由 Node 直接加载 `.ts`，
 * 包内相对导入写 `.js` 时 TS 能过、Node 运行时找不到文件；写 `.ts` 又要求所有消费包都开
 * `allowImportingTsExtensions`。走包名则路径由 package.json 的 exports 解析，两边配置都不用动。
 */
export * from '@novel-plus/shared/dto/auth';
export * from '@novel-plus/shared/dto/book';
export * from '@novel-plus/shared/dto/chapter';
export * from '@novel-plus/shared/dto/common';
export * from '@novel-plus/shared/dto/crawl';
export * from '@novel-plus/shared/dto/enums';
export * from '@novel-plus/shared/dto/user';
