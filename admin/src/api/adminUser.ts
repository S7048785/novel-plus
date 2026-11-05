import type {
  CreateUserInput,
  UpdateUserInput,
  UserListResponse,
  UserSummary,
} from '@novel-plus/shared/dto'

import type { UserRole } from './user'
import request from '@/utils/request'

/**
 * 用户后台管理（/api/admin/users）。
 *
 * 类型全部由 shared 的 schema 推出（`z.infer`），与后端同一份定义：
 * id 是 better-auth 生成的 32 位字符串（不是数字），头像字段叫 image 且可空。
 *
 * 为什么这里仍是手写封装而不是 src/api/generated 的 SDK：
 * 生成的 SDK 是「跑着的后端」的快照，接口新增后要等 `pnpm openapi` 才会出现在 generated 里。
 * 不过**类型**已经不需要等 codegen 了——schema 共享之后 `z.infer` 就是契约本身。
 */
export type AdminUser = UserSummary

export type AdminUserListResult = UserListResponse

/** 列表查询参数：keyword 同时匹配昵称与邮箱；role 见下方语义说明 */
export interface AdminUserQuery {
  page: number
  pageSize: number
  keyword?: string
  /**
   * author / admin = 持有该身份；reader = 只有读者（不含作家、管理员）。
   * 后端语义与这里一致，见 server 的 user.query.schema.ts。
   */
  role?: UserRole
}

/** 新增用户：密码只在建号时设置（后端没有重置密码接口）；roles 不传即只有读者身份 */
export type CreateAdminUserParams = CreateUserInput

/** 部分更新：不传的字段不改，image 传 null 表示清空头像，roles 是整体替换 */
export type UpdateAdminUserParams = UpdateUserInput

export async function getAdminUsers(params: AdminUserQuery) {
  return request<AdminUserListResult>({
    url: '/admin/users',
    method: 'get',
    // 空字符串会被当成「匹配空串」，直接剔掉，让后端走「不过滤」分支
    params: { ...params, keyword: params.keyword || undefined, role: params.role || undefined },
  })
}

export async function getAdminUser(id: string) {
  return request<AdminUser>({
    url: `/admin/users/${id}`,
    method: 'get',
  })
}

export async function createAdminUser(data: CreateAdminUserParams) {
  return request<{ id: string }>({
    url: '/admin/users',
    method: 'post',
    data,
  })
}

export async function updateAdminUser(id: string, data: UpdateAdminUserParams) {
  return request<{ id: string }>({
    url: `/admin/users/${id}`,
    method: 'patch',
    data,
  })
}

/** 删除用户（会话与登录凭据一并清理，不可恢复） */
export async function deleteAdminUser(id: string) {
  return request<{ id: string; deleted: number }>({
    url: `/admin/users/${id}`,
    method: 'delete',
  })
}

export async function deleteAdminUsers(ids: string[]) {
  return request<{ deleted: number; ids: string[] }>({
    url: '/admin/users/batch-delete',
    method: 'post',
    data: { ids },
  })
}
