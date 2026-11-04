import { Injectable } from '@nestjs/common';
import { UserRoleRepository } from '../common/repo/user-role.repo.js';
import type { Viewer } from '../common/authz/role.js';

/**
 * 把「登录用户」翻译成「权限视角」：{ id, roles }。
 *
 * 单独成一个 service 而不是让守卫直接查 repo：
 * 1. 守卫（AuthGuard）与 @Public 接口（/user/me 要返回自己的身份）都要用同一套解析逻辑；
 * 2. 以后加 active/封禁、租户等判断时，改这里一处即可，不用同时改守卫和 controller。
 *
 * 身份不放进会话：user_role 是独立表，better-auth 的 session 拿不到它；
 * 每次请求按主键查一次（走 user_role 的复合主键），成本可忽略，好处是改身份立即生效、
 * 不需要让用户重新登录。
 */
@Injectable()
export class ViewerService {
  constructor(private readonly roleRepo: UserRoleRepository) {}

  async getViewer(userId: string): Promise<Viewer> {
    return { id: userId, roles: await this.roleRepo.findRolesByUserId(userId) };
  }
}
