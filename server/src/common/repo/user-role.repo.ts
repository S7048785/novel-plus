import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray } from 'drizzle-orm';
import { DB, type Db } from '../../db/database.js';
import { userRole } from '../../db/schema.js';
import { BASE_ROLE, USER_ROLES, type UserRole } from '../authz/role.js';

/**
 * 用户身份 Repository：读写 user_role 关联表。
 *
 * 这张表的写入只有一个入口形态——「整体替换某个用户的身份集合」，
 * 所以这里不提供 add/remove 单条操作：多步增删容易写出「既没删干净也没加全」的中间态，
 * 而身份变更本来就是一次事务内的整体决策。
 */
@Injectable()
export class UserRoleRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** 单个用户的身份（按固定顺序返回，便于前端标签稳定排序） */
  async findRolesByUserId(userId: string): Promise<UserRole[]> {
    const rows = await this.db
      .select({ role: userRole.role })
      .from(userRole)
      .where(eq(userRole.userId, userId));
    return sortRoles(rows.map((r) => r.role as UserRole));
  }

  /** 批量查身份：列表页一次查完，避免每个用户一条 SQL */
  async findRolesByUserIds(userIds: string[]): Promise<Map<string, UserRole[]>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ userId: userRole.userId, role: userRole.role })
      .from(userRole)
      .where(inArray(userRole.userId, userIds));

    const grouped = new Map<string, UserRole[]>();
    for (const row of rows) {
      const list = grouped.get(row.userId) ?? [];
      list.push(row.role as UserRole);
      grouped.set(row.userId, list);
    }
    for (const [key, value] of grouped) grouped.set(key, sortRoles(value));
    return grouped;
  }

  /**
   * 整体替换某用户的身份集合（事务内先删后插）。
   *
   * 自动补齐 reader：reader 是所有账号的基础身份，调用方漏传时不该产生「没有任何身份」的账号
   * ——那会让权限判断、列表标签、筛选全部出现空集合特例。
   */
  async replaceForUser(userId: string, roles: UserRole[]): Promise<UserRole[]> {
    const next = sortRoles(withBaseRole(roles));

    await this.db.transaction(async (tx) => {
      await tx.delete(userRole).where(eq(userRole.userId, userId));
      await tx.insert(userRole).values(next.map((role) => ({ userId, role })));
    });
    return next;
  }

  /** 建号时写入初始身份（同样保证含 reader） */
  async insertForUser(userId: string, roles: UserRole[]): Promise<UserRole[]> {
    const next = sortRoles(withBaseRole(roles));
    await this.db.insert(userRole).values(next.map((role) => ({ userId, role })));
    return next;
  }

  /** 统计持有某身份的账号数（用于「不能移除最后一个管理员」的校验） */
  async countByRole(role: UserRole): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(userRole)
      .where(eq(userRole.role, role));
    return Number(row?.value ?? 0);
  }

  /** 该用户是否持有某身份 */
  async hasRole(userId: string, role: UserRole): Promise<boolean> {
    const [row] = await this.db
      .select({ value: count() })
      .from(userRole)
      .where(and(eq(userRole.userId, userId), eq(userRole.role, role)));
    return Number(row?.value ?? 0) > 0;
  }
}

/** 补上基础身份并去重 */
export function withBaseRole(roles: UserRole[]): UserRole[] {
  return roles.includes(BASE_ROLE) ? roles : [BASE_ROLE, ...roles];
}

/**
 * 按 USER_ROLES 的声明顺序排序（reader → author → admin）。
 * 库里没有顺序保证，前端标签、接口响应都希望稳定，所以在这里统一。
 */
export function sortRoles(roles: UserRole[]): UserRole[] {
  const unique = [...new Set(roles)];
  return USER_ROLES.filter((role) => unique.includes(role));
}
