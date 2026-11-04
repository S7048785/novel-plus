import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../common/authz/role.js';

/** 元数据键：声明访问该路由所需的身份集合（满足任意一个即可） */
export const ROLES_KEY = 'authz:roles';

/**
 * 声明接口所需身份，例如 `@Roles('admin')`、`@Roles('admin', 'author')`。
 *
 * 语义是「或」而不是「且」：`@Roles('admin','author')` 表示两者任有其一即可。
 * 需要「同时具备」的场景（例如作家兼管理员才能做的操作）请写进 service 里显式判断——
 * 装饰器只做粗粒度的入口控制，细粒度权限（比如「这本书是不是你的」）本来就依赖数据，
 * 不该塞进元数据。
 *
 * 不标 @Roles 的受保护接口 = 任何已登录身份都能访问（当前所有读接口的现状）。
 * 标在 controller 类上表示整个 controller 都要求该身份。
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
