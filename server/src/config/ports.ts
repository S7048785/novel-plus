import { config } from '@novel-plus/shared';

/**
 * 后端监听端口的取值规则。
 *
 * 端口本身在 `packages/shared`（前后端共用的唯一出处），这里只负责「谁优先」：
 * - `PORT` 环境变量优先。部署时端口是环境决定的（容器映射、云平台注入），不该由仓库常量说了算。
 * - 没有 `PORT`（本地开发）才回落到 shared 里的值。
 *
 * 做成惰性函数而不是模块级常量：auth.config.ts 会被 seeder / better-auth CLI 这类
 * 「没有 Nest 容器」的场景加载，模块一被 import 就求值没必要也容易出意外。
 */
let cachedPort: number | undefined;

export function getServerPort(): number {
  cachedPort ??= Number(process.env.PORT) || config.ports.server;
  return cachedPort;
}
