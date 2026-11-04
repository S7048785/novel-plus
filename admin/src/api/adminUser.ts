import request from '@/utils/request'

import type { UserRole } from './user'

/**
 * 用户后台管理（/api/admin/users）。
 *
 * 为什么这里是手写封装而不是用 src/api/generated 的 SDK：
 * 生成的 SDK 是「跑着的后端」的快照，本模块的接口是新增的，要等后端起来后执行
 * `pnpm openapi` 才会出现在 generated 里。等生成完成，本文件可以删掉、调用处换成
 * generated 的 `usersList` / `usersCreate` 等函数——接口路径与字段名已按后端契约写好，
 * 替换时不需要改业务代码里的参数结构。
 *
 * 字段与服务端的 user 表对齐：id 是 better-auth 生成的 32 位字符串（不是数字），
 * 头像字段叫 image 且可空。
 */
export interface AdminUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  /** 身份集合，至少含 reader，按 reader → author → admin 排序 */
  roles: UserRole[]
  createdAt: string
  updatedAt: string
}

/** 列表查询参数：keyword 同时匹配昵称与邮箱；role 见下方语义说明 */
export interface AdminUserQuery {
  page: number
  pageSize: number
  keyword?: string
  /**
   * author / admin = 持有该身份；reader = 只有读者（不含作家、管理员）。
   * 后端语义与这里一致，见后端的 user.query.schema.ts。
   */
  role?: UserRole
}

export interface AdminUserListResult {
  list: AdminUser[]
  total: number
  page: number
  pageSize: number
}

/** 新增用户：密码只在建号时设置（后端没有重置密码接口）；roles 不传即只有读者身份 */
export interface CreateAdminUserParams {
  email: string
  name: string
  password: string
  image?: string | null
  /** 附加身份（不含 reader，它由服务端自动补齐） */
  roles?: UserRole[]
}

/** 部分更新：不传的字段不改，image 传 null 表示清空头像，roles 是整体替换 */
export interface UpdateAdminUserParams {
  email?: string
  name?: string
  image?: string | null
  roles?: UserRole[]
}

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
