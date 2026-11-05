import { ASSIGNABLE_ROLES, USER_ROLES, USER_ROLE_LABELS } from '@novel-plus/shared'
import type { AssignableRole, UserRole } from '@novel-plus/shared'
import type { MeResponse, SessionUser, UserSummary } from '@novel-plus/shared/dto'

import request from '@/utils/request'

/**
 * 身份（角色）的值域与中文名都来自 `@novel-plus/shared`——与后端同一份定义，不再手抄一遍。
 *
 * 这里只做转出，调用方的 import 路径（`@/api`）不变：
 * - reader：基础身份，所有账号都有（能登录、能读）
 * - author：拥有书籍/章节接口能力，只能操作自己名下的书；**进不了后台**
 * - admin：全量权限（用户管理、书源采集、所有书），也是唯一能进后台的身份
 */
export { ASSIGNABLE_ROLES, USER_ROLES, USER_ROLE_LABELS }
export type { AssignableRole, UserRole }

/**
 * session.user 的形状：**不含 roles**。
 *
 * roles 来自独立的 user_role 表，不在 better-auth 的会话对象里（见后端 meResponseSchema 的说明）。
 * 之前前端把它写成含 roles 的 UserInfo，是个类型谎言——登录响应的 user 里根本没有这个字段；
 * 现在用 shared 的 sessionUserSchema 推出的精确类型，需要身份就去看 `MeResult.roles`。
 */
export type { SessionUser }

/** 后台用户列表行：账号字段 + 身份集合（对应后端 userSummarySchema） */
export type UserInfo = UserSummary

/** 登录参数：better-auth 的 email+password 登录 */
export interface SignInParams {
  email: string
  password: string
}

/** 当前登录用户 + 身份（来自 shared 的 meResponseSchema；未登录时 user 为 null、roles 为空） */
export type MeResult = MeResponse

/**
 * 登录：POST /api/auth/sign-in/email
 *
 * 后端返回 { redirect, token, user }，但登录态实际靠 Set-Cookie 写入 httpOnly 会话 cookie，
 * 前端不持久化 token（token 仅用于 better-auth 自身的重定向协议，业务上不用）。
 *
 * 这里的 user 是 session.user（无 roles）：身份要再问一次 /user/me，所以调用方登录后必须 fetchMe。
 */
export async function signIn(data: SignInParams) {
  return request<{ redirect: boolean; token: string | null; user: SessionUser }>({
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
