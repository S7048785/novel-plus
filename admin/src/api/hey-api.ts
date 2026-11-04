import type { CreateClientConfig } from './generated/client.gen'

/**
 * hey-api 客户端的运行时配置。
 *
 * 这个文件由 openapi-ts.config.ts 的 runtimeConfigPath 指定：生成的 client.gen.ts 会在
 * 初始化 client 实例之前调用 createClientConfig()，因此这里是唯一该改配置的地方
 * ——直接改 src/api/generated/** 会被下次生成覆盖掉。
 *
 * baseURL 留空的理由：后端所有接口都在 /api 前缀下（服务端的 setGlobalPrefix('api')），
 * 生成出来的 path 本身已经是 `/api/admin/book` 这种完整路径。开发环境用空 baseURL 走 vite proxy
 * 同源转发（见 vite.config.ts 的 server.proxy），生产环境再用 VITE_SITE_BASE_API 指向真实后端。
 */
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseURL: import.meta.env.DEV ? '' : import.meta.env.VITE_SITE_BASE_API,
  // 登录态是 better-auth 写的 httpOnly cookie，跨源时必须显式允许携带
  withCredentials: true,
  timeout: 10_000,
})
