import { useMutation, useQuery, useQueryCache } from '@pinia/colada'

import {
  createAdminBookSource,
  deleteAdminBookSource,
  deleteAdminBookSources,
  getAdminBookSource,
  getAdminBookSources,
  replaceAdminBookSource,
  updateAdminBookSource,
} from '@/api'

import type {
  AdminBookSourceQuery,
  ReplaceAdminBookSourceParams,
  UpdateAdminBookSourceParams,
} from '@/api'
import type { BatchDeleteResponse, DeleteResponse, IdResponse } from '@novel-plus/shared/dto'

/**
 * 书源模块的数据访问层（结构同 features/book/queries.ts）。
 *
 * 所有 key 与 useQuery / useMutation 都收在这里，组件只管渲染与交互：
 * 缓存与失效完全由 key 决定，散在组件里迟早出现「一处改了 key、另一处还在用旧 key」的幽灵缓存。
 *
 * 新增 / 改规则（POST / PUT）留在 SourceFormModal 里直接 await：
 * 那两个要先把 JSON 解析、表单校验都过一遍，套 mutation 只是多一层包装。
 * 列表里会反复触发的（删除、启用开关）才做成 mutation。
 */

/* ------------------------------ query keys ------------------------------ */

const SOURCE_LIST = 'adminBookSources'
const SOURCE_DETAIL = 'adminBookSource'

export const sourceKeys = {
  listAll: [SOURCE_LIST] as const,
  list: (query: AdminBookSourceQuery) =>
    [SOURCE_LIST, query.page, query.pageSize, query.keyword ?? '', query.enabled ?? null] as const,
  detail: (id: number) => [SOURCE_DETAIL, id] as const,
}

/* ------------------------------ 读 ------------------------------ */

/**
 * 书源列表。
 *
 * 传 getter 而不是普通对象：分页/筛选变化时 key 要跟着变，useQuery 自己会重新请求，
 * 组件不需要 watch + refetch 那套手工同步。
 */
export function useSourceList(query: () => AdminBookSourceQuery) {
  return useQuery({
    key: () => sourceKeys.list(query()),
    query: () => getAdminBookSources(query()),
    staleTime: 0,
  })
}

/**
 * 书源详情（含完整规则体）。
 *
 * 只有「编辑规则」抽屉需要它——列表刻意不带规则体（一行几 KB，整页带会把响应撑爆）。
 * id 为空时 key 用 0 占位（EntryKey 要求可序列化，不能放 undefined），由 enabled 挡住请求。
 */
export function useSourceDetail(id: () => number | undefined, enabled: () => boolean) {
  return useQuery({
    key: () => sourceKeys.detail(id() ?? 0),
    query: () => getAdminBookSource(id() as number),
    enabled,
  })
}

/* ------------------------------ 写 ------------------------------ */

export interface MutationCallbacks<TData = void> {
  onSuccess?: (data: TData) => void
  onError?: (error: unknown) => void
}

/** 删除单个书源（已采集的书籍保留，后端不级联删内容） */
export function useDeleteSource(callbacks: MutationCallbacks<DeleteResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: deleteAdminBookSource,
    onSuccess: (data) => {
      // 前缀匹配：所有分页/筛选组合的列表一起失效（当前激活的会自动重取）
      cache.invalidateQueries({ key: [...sourceKeys.listAll] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}

/** 批量删除书源 */
export function useDeleteSources(callbacks: MutationCallbacks<BatchDeleteResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: deleteAdminBookSources,
    onSuccess: (data) => {
      cache.invalidateQueries({ key: [...sourceKeys.listAll] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}

/**
 * 部分更新（PATCH）：列表里的启用开关用它，只传 `{ enabled }`，规则体原样保留。
 *
 * 详情缓存也一起失效：同一份数据在抽屉里可能正开着，不失效会看到旧的 enabled。
 */
export function useUpdateSource(callbacks: MutationCallbacks<IdResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: (input: { id: number; changes: UpdateAdminBookSourceParams }) =>
      updateAdminBookSource(input.id, input.changes),
    onSuccess: (data, input) => {
      cache.invalidateQueries({ key: [...sourceKeys.listAll] })
      cache.invalidateQueries({ key: [...sourceKeys.detail(input.id)] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}

/**
 * 新增书源（POST，请求体是完整配置）。
 *
 * 放在数据层而不是组件内 await，是为了让「建完要让列表过期」这件事跟着 mutation 走：
 * 漏掉失效的表现是「新建成功但列表里没有」，比多写一层难查得多。
 */
export function useCreateSource(callbacks: MutationCallbacks<IdResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: createAdminBookSource,
    onSuccess: (data) => {
      cache.invalidateQueries({ key: [...sourceKeys.listAll] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}

/**
 * 全量覆盖（PUT，编辑抽屉用）。
 *
 * 为什么编辑走 PUT 而不是 PATCH：抽屉里展示的就是**完整配置**（标量 + 规则 JSON），
 * 用户看到什么就提交什么，PUT 的「未携带即清空」正好对应「表单里删掉就是删掉」。
 * 只有行内开关那种「只改一个字段、不该碰规则体」的场景才用 PATCH。
 */
export function useReplaceSource(callbacks: MutationCallbacks<IdResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: (input: { id: number; data: ReplaceAdminBookSourceParams }) =>
      replaceAdminBookSource(input.id, input.data),
    onSuccess: (data, input) => {
      cache.invalidateQueries({ key: [...sourceKeys.listAll] })
      cache.invalidateQueries({ key: [...sourceKeys.detail(input.id)] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}
