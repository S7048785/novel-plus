import { z } from 'zod';

/**
 * 用户身份（角色）的唯一定义处。
 *
 * 三个身份不是「等级」而是「能力集合」：
 * - reader：基础身份，所有账号都有（能登录、能读）。
 * - author：拥有书籍 / 章节接口能力，但**只能读写自己名下的书**。
 *   注意：作家**进不了后台**（admin 控制台只允许管理员登录）——这个身份目前是给将来的
 *   作家端预留的接口能力，不是「后台准入资格」。
 * - admin：全量权限（用户管理、书源与采集、所有书），也是唯一能进后台的身份。
 *
 * 一个账号可以同时持有多个身份（如 admin + author），所以库里是 user_role 关联表，
 * 判断权限一律用「集合里有没有某个值」，不要写成 `role === 'admin'` 这种单值比较。
 *
 * 为什么 role 列用 varchar 而不是 MySQL ENUM：加第四个身份（如 auditor）时
 * ENUM 要 ALTER TABLE，而身份集合的演进是可预期的；值域由这里的 zod enum 兜住，
 * 写库前统一过校验，DB 层只保证长度。
 */
export const USER_ROLES = ['reader', 'author', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** 所有账号都具备的基础身份；建号与改身份时都保证它在集合里 */
export const BASE_ROLE: UserRole = 'reader';

/** 可分配的身份（reader 是基础身份，不通过接口「分配」，而是自动补齐） */
export const ASSIGNABLE_ROLES = ['author', 'admin'] as const;

export const userRoleSchema = z.enum(USER_ROLES);

/** 请求体里允许指定的身份：只能给 author / admin，reader 由服务端补 */
export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES);

/**
 * 当前请求者（从会话 + user_role 解析而来）。
 *
 * 设计成显式参数而不是从请求上下文里偷偷取：
 * service 层的归属判断需要知道「谁在操作」，把它作为入参能让每个方法都清楚自己依赖身份，
 * 也方便单测直接传一个假 viewer。
 */
export interface Viewer {
  id: string;
  roles: UserRole[];
}

export function hasRole(viewer: Viewer, role: UserRole): boolean {
  return viewer.roles.includes(role);
}

/** 管理员：全量数据可见，也是唯一能进后台的身份 */
export function isAdmin(viewer: Viewer): boolean {
  return hasRole(viewer, 'admin');
}
