import { Controller, Get } from '@nestjs/common';
import { Session, type SessionResult } from './session.decorator.js';
import { ViewerService } from './viewer.service.js';
import { meResponseSchema } from './auth.response.schema.js';
import { ApiZodOk } from '../common/dto/openapi.js';
import { Public } from './public.decorator.js';

/**
 * 鉴权相关的业务侧接口。
 *
 * 这里**只放 better-auth 不提供的读接口**。注册/登录/登出/会话查询这些已经有现成端点，
 * 全部由 better-auth 在 /api/auth/* 下提供，不要再写一遍：
 *   POST /api/auth/sign-in/email   { email, password }        → 登录（写 cookie）
 *   POST /api/auth/sign-out                                   → 登出
 *   GET  /api/auth/get-session                                → 会话（未登录返回 null）
 *
 * 路径是 /user 而不是 /auth：main.ts 统一加了 /api 前缀，若挂成 /api/auth/me，
 * 会落到 better-auth 的 `/api/auth/*` 通配 handler 上（它先于 Nest 路由注册，先匹配先赢），
 * 请求根本到不了这里。换个命名空间是零成本的解法。
 */
@Controller('user')
export class AuthController {
  constructor(private readonly viewerService: ViewerService) {}

  /**
   * 当前登录用户 + 身份。
   *
   * 为什么不直接用 better-auth 的 get-session：那边返回的 user 里没有身份——
   * 身份在独立的 user_role 表里，better-auth 不知道它存在，也没法 join。
   * 所以前端「我是谁 + 我能做什么」统一走这个接口，一次请求拿全。
   *
   * 返回固定信封 `{ user, roles }`，未登录时 user 为 null、roles 为空数组：
   * Nest 会把裸 null 序列化成空 body（不是 "null"），前端 res.json() 会直接抛错，
   * 所以这里不能直接 return null。也不用 401——前端判断登录态用 200 + user 是否为 null 更省事。
   *
   * 因此这是**唯一标了 @Public 的业务读接口**（另一个是健康检查）：
   * 它的用途就是「在未登录时也能问一句我是谁」，被守卫拦下来就失去意义了。
   */
  @Get('me')
  @Public()
  @ApiZodOk(meResponseSchema)
  async me(@Session() session: SessionResult) {
    if (!session) return { user: null, roles: [] };

    const viewer = await this.viewerService.getViewer(session.user.id);
    return { user: session.user, roles: viewer.roles };
  }
}
