/**
 * 列表页通用的分页常量。
 *
 * 放在这里而不是各模块的 constants.ts：书籍、用户、章节三处用的是同一套候选值，
 * 各写一份迟早出现「这页能选 100、那页只能选 50」。
 *
 * `PAGE_SIZE_MAX` 与后端各 query schema 的 `.max()` 对齐（book / user 是 100，chapter 是 200），
 * 越过上限后端会 400，所以别在单个页面里随手加更大的候选。
 */

/** 每页条数候选（书籍 / 用户列表用，上限 100 与后端一致） */
export const PAGE_SIZES: number[] = [10, 20, 50, 100]

export const DEFAULT_PAGE_SIZE = 10
