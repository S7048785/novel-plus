import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DB, type Db } from '../db/database.js';
import { RepositoryModule } from '../common/repo/repository.module.js';
import { AUTH } from './auth.tokens.js';
import { createAuth, type Auth } from './auth.config.js';
import { AuthGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';
import { ViewerService } from './viewer.service.js';

/**
 * 鉴权模块（全局）。
 *
 * 负责三件事：
 * 1. 持有并暴露 better-auth 实例；
 * 2. 注册全局守卫（APP_GUARD）：登录判断 + @Roles 身份判断；
 * 3. 暴露 ViewerService：把登录用户翻译成 { id, roles }。
 *
 * better-auth 的路由是 Web 标准 handler，挂载必须在 Express 层完成（见 main.ts），
 * Nest 的 Controller 体系接不住它（Controller 走 Nest 自己的参数解析与响应封装）。
 *
 * auth 必须单例并放进 DI：实例内部持有 drizzle 实例（与 repo 同一连接池）和会话缓存，
 * 每次请求新建会撑爆连接池并让会话校验失去一致性。
 *
 * 这里 import RepositoryModule 是为了拿 UserRoleRepository（查身份）。
 * 依赖方向是 Auth → Repository → Database，不产生环：AdminModule 用的是 Auth 提供的
 * 守卫与 viewer，不会被 Auth 反向依赖。
 */
@Global()
@Module({
  imports: [RepositoryModule],
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH,
      inject: [DB],
      useFactory: (db: Db): Auth => createAuth(db),
    },
    ViewerService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [AUTH, ViewerService],
})
export class AuthModule {}
