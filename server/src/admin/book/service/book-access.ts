import { ForbiddenException } from '@nestjs/common';
import { isAdmin, type Viewer } from '../../../common/authz/role.js';

/** 判断归属所需的最小字段（列表、详情、章节入口都能提供） */
export interface BookOwnership {
  id: number;
  /** null = 系统书（采集入库或管理员建的公共书） */
  ownerId: string | null;
}

/**
 * 书籍归属校验：管理员看全部，作家只能碰自己名下的书。
 *
 * 规则里有两个容易踩的点，都在这里一次性说清：
 * 1. **owner_id 为 null 的书是「系统书」**（采集入库或管理员建的公共书），
 *    它们不属于任何作家，只有管理员能改——不能把 null 当成「无主，谁都能动」。
 * 2. 返回 403 而不是 404：书确实存在，只是不归你。用 404 会把「没有」和「不让」混为一谈，
 *    排查权限问题时更费劲；书 id 是自增数字，本来也藏不住存在性。
 */
export function assertBookAccessible(book: BookOwnership, viewer: Viewer): void {
  if (isAdmin(viewer)) return;
  if (book.ownerId !== null && book.ownerId === viewer.id) return;

  throw new ForbiddenException('无权操作该书籍：只能操作自己名下的书');
}

/**
 * 列表查询的归属范围：管理员不限制（undefined），其他人限定为自己的 id。
 *
 * 用「在 SQL 里加过滤」而不是「查出来再筛」，否则分页的 total 会算进别人的书，
 * 前端会看到「总数 20 但只有 3 条」这种对不上的数字。
 */
export function ownerScope(viewer: Viewer): string | undefined {
  return isAdmin(viewer) ? undefined : viewer.id;
}
