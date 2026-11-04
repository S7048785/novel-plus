import request from '@/utils/request'

/**
 * 身份（角色）定义，与后端 server/src/common/authz/role.ts 一一对应。
 *
 * 三个身份不是等级而是能力集合，一个账号可以同时持有多个：
 * - reader：基础身份，所有账号都有（能登录、能读）
 * - author：拥有书籍/章节接口能力，只能操作自己名下的书；**进不了后台**
 * - admin：全量权限（用户管理、书源采集、所有书），也是唯一能进后台的身份
 */
export const USER_ROLES = ['reader', 'author', 'admin'] as const

export type UserRole = (typeof USER_ROLES)[number]

/** 可勾选的身份（reader 是基础身份，界面上展示但不可取消） */
export const ASSIGNABLE_ROLES = ['author', 'admin'] as const

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  reader: '读者',
  author: '作家',
  admin: '管理员',
}

/** 后端 better-auth 返回的用户对象（与服务端的 user 表对齐） */
export interface UserInfo {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: string
  updatedAt: string
}

/** 登录参数：better-auth 的 email+password 登录 */
export interface SignInParams {
  email: string
  password: string
}

/** 当前登录用户 + 身份 */
export interface MeResult {
  user: UserInfo | null
  roles: UserRole[]
}

/**
 * 登录：POST /api/auth/sign-in/email
 *
 * 后端返回 { redirect, token, user }，但登录态实际靠 Set-Cookie 写入 httpOnly 会话 cookie，
 * 前端不持久化 token（token 仅用于 better-auth 自身的重定向协议，业务上不用）。
 */
export async function signIn(data: SignInParams) {
  return request<{ redirect: boolean; token: string | null; user: UserInfo }>({
    url: '/auth/sign-in/email',
    method: 'post',
    data,
  })
}

/**
 * 当前登录态 + 身份：GET /api/user/me
 *
 * 为什么不用 better-auth 的 /api/auth/get-session：那边返回的 user 里没有身份——
 * 身份在独立的 user_role 表里，better-auth 不知道它存在。业务侧 /user/me 一次给全
 * （user + roles），未登录时返回 { user: null, roles: [] }，不会 401。
 *
 * 注：该接口也已出现在 generated 里（authMe），等下次 `pnpm openapi` 后可换成生成函数的返回类型。
 */
export async function getMe() {
  return request<MeResult>({
    url: '/user/me',
    method: 'get',
  })
}

/** 登出：POST /api/auth/sign-out（清除服务端会话 + 让浏览器丢弃 cookie） */
export async function signOut() {
  return request<{ success: boolean }>({
    url: '/auth/sign-out',
    method: 'post',
  })
}
