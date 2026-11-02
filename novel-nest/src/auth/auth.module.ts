import { Global, Module } from '@nestjs/common';
import { DB, type Db } from '../db/database.js';
import { createAuth, type Auth } from './auth.config.js';
import { AuthController } from './auth.controller.js';

/**
 * better-auth 实例的注入 token。
 * 用常量而非裸字符串，理由同 db/database.ts 的 DB —— 拼错不会静默拿到 undefined。
 */
export const AUTH = 'AUTH';

/**
 * 鉴权模块（全局）。
 *
 * 这里只负责「持有并暴露 auth 实例」，不注册任何 HTTP 路由：
 * better-auth 的路由是 Web 标准 handler，挂载必须在 Express 层完成（见 main.ts），
 * Nest 的 Controller 体系接不住它（Controller 走 Nest 自己的参数解析与响应封装）。
 *
 * 之所以要单例并放进 DI：auth 内部持有 drizzle 实例（与 repo 同一连接池）和 session 缓存，
 * 每次请求新建一个实例会导致连接池被撑爆且会话校验失去一致性。
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH,
      inject: [DB],
      useFactory: (db: Db): Auth => createAuth(db),
    },
  ],
  exports: [AUTH],
})
export class AuthModule {}
