import { Controller, Get } from '@nestjs/common';
import { Session, type SessionResult } from './session.decorator.js';

/**
 * 鉴权相关的业务侧接口。
 *
 * 这里**只放 better-auth 不提供的读接口**。注册/登录/登出/会话查询这些已经有现成端点，
 * 全部由 better-auth 在 /api/auth/* 下提供，不要再写一遍：
 *   POST /api/auth/sign-in/email   { email, password }        → 登录（写 cookie）
 *   POST /api/auth/sign-out                                   → 登出
 *   GET  /api/auth/get-session                                → 会话（未登录返回 null）
 *
 * 本控制器的作用有两个：给前端一个「当前用户」的语义化入口，以及作为
 * 「在 Nest 里怎么取登录态」的活样例——照着 @Session() 的用法抄即可。
 */
@Controller('auth')
export class AuthController {
  /**
   * 当前登录用户。
   *
   * 返回固定信封 `{ user }`，未登录时 user 为 null：
   * Nest 会把裸 null 序列化成空 body（不是 "null"），前端 res.json() 会直接抛错，
   * 所以这里不能直接 return null。
   * 也不用 401——前端判断登录态用 200 + user 是否为 null 更省事；需要严格 401 的场景后续配守卫。
   */
  @Get('me')
  me(@Session() session: SessionResult) {
    return { user: session?.user ?? null };
  }
}
