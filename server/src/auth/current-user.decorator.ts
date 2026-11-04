import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Viewer } from '../common/authz/role.js';
import type { AuthAttachedRequest } from './session.decorator.js';

/**
 * 取当前请求者的身份（userId + roles），由 AuthGuard 解析并挂到请求上。
 *
 * 与 @Session() 的区别：@Session() 给的是 better-auth 的原始会话对象（含 token、过期时间等），
 * 这里给的是「做权限判断真正需要的两样东西」——谁的请求、他有哪些身份。
 * service 层判断书籍归属用的就是这个对象。
 *
 * 只有走过守卫的非 @Public 接口才有 viewer：@Public 接口想拿身份请显式用 @Session() 再查。
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): Viewer => {
  const request = ctx.switchToHttp().getRequest<AuthAttachedRequest>();
  if (!request.viewer) {
    throw new Error('viewer 未挂载：检查该路由是否被标了 @Public()，或守卫未注册');
  }
  return request.viewer;
});
