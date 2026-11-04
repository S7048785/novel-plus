/**
 * 鉴权相关的 DI token。
 *
 * 单独成文件是为了打断 import 循环：AuthGuard 需要注入 AUTH，而 AuthModule 又要注册 AuthGuard。
 * 若 token 定义在 auth.module.ts 里，两者就互为依赖——ESM 下 `@Inject(AUTH)` 在类装饰时求值，
 * 循环时可能拿到 undefined，表现为「运行时才报 provider 找不到」，很难查。
 *
 * 用常量而非裸字符串的理由同 db/database.ts 的 DB：拼错不会静默拿到 undefined。
 */
export const AUTH = 'AUTH';
