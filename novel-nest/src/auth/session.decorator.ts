import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import type { Auth } from './auth.config.js';

/**
 * 登录态是 httpOnly cookie，不是 Authorization 头，所以「取当前用户」的唯一正确姿势是
 * 把请求头交给 better-auth 让它自己解 cookie：auth.api.getSession({ headers }).
 * fromNodeHeaders 的作用就是把 Node 的 IncomingHttpHeaders 转成 Web 标准 Headers。
 */
export type SessionResult = Awaited<ReturnType<Auth['api']['getSession']>>;

/** main.ts 在挂载 better-auth handler 的同时把实例挂到请求上，装饰器从这里取（见 attachAuth） */
export type AuthAttachedRequest = Request & { auth?: Auth };

/**
 * 让每个请求都能拿到 auth 实例。
 *
 * 为什么走 app.use 而不是 Nest 中间件/守卫：参数装饰器拿不到 DI 容器，
 * 只能从请求对象上取东西；这里是纯赋值（不查库），对现有接口没有额外开销。
 */
export function attachAuth(auth: Auth) {
  return (req: AuthAttachedRequest, _res: unknown, next: () => void): void => {
    req.auth = auth;
    next();
  };
}

/**
 * 取当前登录态：未登录返回 null，已登录返回 { session, user }。
 *
 * 用法：
 *   @Get('me')
 *   me(@Session() session: SessionResult) { return session?.user ?? null; }
 *
 * 注意它**不做鉴权**——没登录只是拿到 null。要拦请求得配守卫（下一步再做），
 * 现在所有接口仍是公开的。
 */
export const Session = createParamDecorator(async (_data: unknown, ctx: ExecutionContext): Promise<SessionResult> => {
  const req = ctx.switchToHttp().getRequest<AuthAttachedRequest>();
  if (!req.auth) {
    // 只有 main.ts 漏了 attachAuth 才会走到这里，属于装配错误，不该被当成「未登录」
    throw new Error('auth 实例未挂载到请求上，检查 main.ts 是否调用了 attachAuth(auth)');
  }
  return req.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
});
