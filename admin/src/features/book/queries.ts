import { useMutation, useQuery, useQueryCache } from '@pinia/colada'

import {
  deleteAdminBook,
  deleteAdminBooks,
  deleteAdminChapter,
  deleteAdminChapters,
  getAdminBook,
  getAdminBooks,
  getAdminChapter,
  getAdminChapters,
} from '@/api'

import type { AdminBookQuery, AdminChapterQuery } from '@/api'
import type { BatchDeleteResponse, DeleteResponse } from '@novel-plus/shared/dto'

/**
 * 书籍模块的数据访问层。
 *
 * 所有 query key 与 useQuery / useMutation 都收在这里，组件只管渲染与交互。
 * 集中 key 的理由：缓存与失效完全由 key 决定，散在组件里迟早出现
 * 「一处改了 key、另一处还在用旧 key」的幽灵缓存（表现为删完不回列表、改完看到的还是旧数据）。
 *
 * 注意包名：项目用的是 **@pinia/colada**（TanStack Query 的 Pinia 版），不是 @tanstack/vue-query，
 * 但两者的 key-失效模型是同一套思路，所以隔离在这一层之后，将来换库只改这个文件。
 *
 * 写操作（弹窗里的提交）目前仍是组件内 `await createAdminBook(...)`：
 * 表单要先过 naive-ui 的校验再提交，套 mutation 只是多一层包装。等出现「乐观更新 / 统一重试」
 * 这类需求再迁过来。
 */

/* ------------------------------ query keys ------------------------------ */

/** key 的第一个元素就是「这一组查询」的命名空间，失效时按前缀匹配 */
const BOOK_LIST = 'adminBooks'
const BOOK_DETAIL = 'adminBook'
const CHAPTER_LIST = 'adminChapters'
const CHAPTER_DETAIL = 'adminChapter'

export const bookKeys = {
  listAll: [BOOK_LIST] as const,
  list: (query: AdminBookQuery) =>
    [BOOK_LIST, query.page, query.pageSize, query.keyword ?? '', query.origin ?? null] as const,
  detail: (id: number) => [BOOK_DETAIL, id] as const,
  chapterListAll: [CHAPTER_LIST] as const,
  chapterList: (bookId: number, query: AdminChapterQuery) =>
    [CHAPTER_LIST, bookId, query.page, query.pageSize] as const,
  chapterDetail: (bookId: number, chapterId: number) => [CHAPTER_DETAIL, bookId, chapterId] as const,
}

/* ------------------------------ 读 ------------------------------ */

/**
 * 书籍列表。
 *
 * 传 getter 而不是普通对象：分页/筛选变化时 key 要跟着变，`useQuery` 自己会重新请求，
 * 组件不需要 watch + refetch 那套手工同步。
 */
export function useBookList(query: () => AdminBookQuery) {
  return useQuery({
    key: () => bookKeys.list(query()),
    query: () => getAdminBooks(query()),
    staleTime: 0,
  })
}

/** 单本书（章节页顶部要显示「在管哪本书」） */
export function useBookDetail(bookId: () => number) {
  return useQuery({
    key: () => bookKeys.detail(bookId()),
    query: () => getAdminBook(bookId()),
    enabled: () => Number.isFinite(bookId()),
  })
}

/** 章节列表（不含正文） */
export function useChapterList(bookId: () => number, query: () => AdminChapterQuery) {
  return useQuery({
    key: () => bookKeys.chapterList(bookId(), query()),
    query: () => getAdminChapters(bookId(), query()),
    enabled: () => Number.isFinite(bookId()),
    staleTime: 0,
  })
}

/**
 * 章节详情（含正文）。
 *
 * 正文只在编辑时拉：列表接口刻意不返回 content（一章几 KB，整页带会把响应撑爆）。
 * `chapterId` 为空时 key 用 0 占位（EntryKey 要求可序列化，不能放 undefined），
 * 由 `enabled` 挡住请求。
 */
export function useChapterDetail(
  bookId: () => number,
  chapterId: () => number | undefined,
  enabled: () => boolean,
) {
  return useQuery({
    key: () => bookKeys.chapterDetail(bookId(), chapterId() ?? 0),
    query: () => getAdminChapter(bookId(), chapterId() as number),
    enabled,
  })
}

/* ------------------------------ 写 ------------------------------ */

/**
 * 写操作的公共回调。
 *
 * 失效（invalidate）留在这一层，提示语留在组件层：数据层不该知道「删完要弹什么字」，
 * 但它必须负责「删完要让哪些缓存过期」。
 */
export interface MutationCallbacks<TData = void> {
  onSuccess?: (data: TData) => void
  onError?: (error: unknown) => void
}

/** 删除单本书 */
export function useDeleteBook(callbacks: MutationCallbacks<DeleteResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: deleteAdminBook,
    onSuccess: (data) => {
      // 前缀匹配：所有分页/筛选组合的列表一起失效（当前激活的会自动重取）
      cache.invalidateQueries({ key: [...bookKeys.listAll] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}

/** 批量删除书籍 */
export function useDeleteBooks(callbacks: MutationCallbacks<BatchDeleteResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: deleteAdminBooks,
    onSuccess: (data) => {
      cache.invalidateQueries({ key: [...bookKeys.listAll] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}

/** 删除单章（章节页，key 要带 bookId 才能只失效这本书的目录） */
export function useDeleteChapter(bookId: () => number, callbacks: MutationCallbacks<DeleteResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: (chapterId: number) => deleteAdminChapter(bookId(), chapterId),
    onSuccess: (data) => {
      cache.invalidateQueries({ key: [CHAPTER_LIST, bookId()] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}

/** 批量删除章节 */
export function useDeleteChapters(
  bookId: () => number,
  callbacks: MutationCallbacks<BatchDeleteResponse> = {},
) {
  const cache = useQueryCache()
  return useMutation({
    mutation: (ids: number[]) => deleteAdminChapters(bookId(), ids),
    onSuccess: (data) => {
      cache.invalidateQueries({ key: [CHAPTER_LIST, bookId()] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}
