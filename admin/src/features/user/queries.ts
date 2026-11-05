import { useMutation, useQuery, useQueryCache } from '@pinia/colada'

import { deleteAdminUser, deleteAdminUsers, getAdminUsers } from '@/api'

import type { AdminUserQuery } from '@/api'
import type { UserBatchDeleteResponse, UserDeleteResponse } from '@novel-plus/shared/dto'

/**
 * 用户模块的数据访问层（结构同 features/book/queries.ts）。
 *
 * 写操作（建号 / 改身份）留在 UserFormModal 里直接 await：表单要先过校验再提交，
 * 套 mutation 只是多一层包装。等出现乐观更新或统一重试的需求再迁过来。
 */

const USER_LIST = 'adminUsers'

export const userKeys = {
  listAll: [USER_LIST] as const,
  list: (query: AdminUserQuery) =>
    [USER_LIST, query.page, query.pageSize, query.keyword ?? '', query.role ?? null] as const,
}

/** 用户列表 */
export function useUserList(query: () => AdminUserQuery) {
  return useQuery({
    key: () => userKeys.list(query()),
    query: () => getAdminUsers(query()),
    staleTime: 0,
  })
}

export interface MutationCallbacks<TData = void> {
  onSuccess?: (data: TData) => void
  onError?: (error: unknown) => void
}

/** 删除单个用户（会话与登录凭据一并清理，不可恢复） */
export function useDeleteUser(callbacks: MutationCallbacks<UserDeleteResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: deleteAdminUser,
    onSuccess: (data) => {
      cache.invalidateQueries({ key: [...userKeys.listAll] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}

/** 批量删除用户 */
export function useDeleteUsers(callbacks: MutationCallbacks<UserBatchDeleteResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: deleteAdminUsers,
    onSuccess: (data) => {
      cache.invalidateQueries({ key: [...userKeys.listAll] })
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}
