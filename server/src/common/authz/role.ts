import type { UserRole } from '@novel-plus/shared';

/**
 * 后端的身份上下文。
 *
 * 值域、zod schema 与中文名的唯一出处已经搬到 `packages/shared`（前后端共用），
 * 这里只保留**后端专属**的部分：`Viewer`（当前请求者），以及给已有引用路径留的 re-export。
 *
 * 新代码可以直接 `import { USER_ROLES } from '@novel-plus/shared'`；
 * 走这个文件也行，两条路指向同一份定义，不会漂移。
 */

export { ASSIGNABLE_ROLES, BASE_ROLE, USER_ROLES } from '@novel-plus/shared';
export type { AssignableRole, UserRole } from '@novel-plus/shared';
export { assignableRoleSchema, userRoleSchema } from '@novel-plus/shared/dto';

/**
 * 当前请求者（从会话 + user_role 解析而来）。
 *
 * 设计成显式参数而不是从请求上下文里偷偷取：
 * 需要按「谁在操作」区分数据时（例如将来作家端只看自己的书），把它作为入参能让每个方法都清楚
 * 自己依赖身份，也方便单测直接传一个假 viewer。
 */
export interface Viewer {
  id: string;
  roles: UserRole[];
}

/**
 * 判断身份用的是「集合里有某个值」，直接写 `viewer.roles.includes(role)` 即可，
 * 不再单独包 hasRole / isAdmin：唯一的调用点是守卫和 @Roles 的比对，
 * 包一层只会多一个需要同步的抽象。
 */
