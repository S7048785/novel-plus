import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { AUTH } from './auth.tokens.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ROLES_KEY } from './roles.decorator.js';
import { ViewerService } from './viewer.service.js';
import type { Auth } from './auth.config.js';
import type { AuthAttachedRequest, SessionResult } from './session.decorator.js';
import type { UserRole } from '../common/authz/role.js';

/**
 * 全局登录 + 身份守卫。
 *
 * 三层判断，顺序不能反：
 * 1. @Public()            → 直接放行（匿名可访问）
 * 2. 有没有会话            → 401（前端据此跳登录页）
 * 3. @Roles(...) 满不满足  → 403（登录了但身份不够）
 *
 * 为什么不用 401 代替 403：前端对 401 的既定处理是清登录态并跳登录页，
 * 一个作家点用户管理就被踢下线，比提示「没有权限」糟糕得多。
 *
 * 身份每次从库里查（见 ViewerService 的说明），所以管理员把某人降级后，
 * 该用户手上的旧会话下一个请求就失效——不用等会话过期，也不会残留权限。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    private readonly reflector: Reflector,
    private readonly viewerService: ViewerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthAttachedRequest>();
    const session: SessionResult = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) throw new UnauthorizedException('未登录或会话已过期');

    /**
     * 把会话挂到请求上供 @Session() 复用：守卫已经查过一次库，
     * 同一个请求里再查一次纯属浪费（且 getSession 在 updateAge 到期时还会写库）。
     * 注意 null 也算「已解析」，所以用 !== undefined 判断（见 session.decorator.ts）。
     */
    request.authSession = session;

    // 身份解析对所有受保护接口都有意义（@CurrentUser() 随取随用），顺带也供下一步判角色
    const viewer = await this.viewerService.getViewer(session.user.id);
    request.viewer = viewer;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles && requiredRoles.length > 0) {
      const allowed = requiredRoles.some((role) => viewer.roles.includes(role));
      if (!allowed) {
        throw new ForbiddenException(`当前身份无权访问（需要：${requiredRoles.join(' 或 ')}）`);
      }
    }

    return true;
  }
}
