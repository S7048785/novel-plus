import type { UserRole } from '@/api'

/**
 * 用户模块的常量。
 *
 * 分页候选是跨模块的，在 `@/constants/pagination`。
 */

/**
 * 身份筛选项。
 *
 * 文案与后端语义严格对齐：作家/管理员是「持有该身份」，读者是「**只有**读者」（不含其他身份）。
 * 所以写作「仅读者」而不是「读者」——后者会让人以为能筛出所有读者，而那等于全部账号
 * （reader 是所有账号的基础身份）。
 */
export const ROLE_FILTER_OPTIONS: Array<{ label: string; value: UserRole }> = [
  { label: '仅读者', value: 'reader' },
  { label: '含作家', value: 'author' },
  { label: '含管理员', value: 'admin' },
]

/** 身份标签配色：读者中性、作家信息色、管理员警示色（权限最高） */
export const ROLE_TAG_TYPE: Record<UserRole, 'default' | 'info' | 'warning'> = {
  reader: 'default',
  author: 'info',
  admin: 'warning',
}

/**
 * 表格横向滚动宽度 = 各列宽之和（selection 列 + 6 个数据列 + 160 的操作列）。
 * 与书籍页同理：有 `fixed: 'right'` 的操作列时，这个值给小了会压扁换行而不是横向滚动。
 */
export const TABLE_SCROLL_X = 1400
