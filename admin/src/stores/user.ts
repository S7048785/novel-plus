import { useStorage } from '@vueuse/core'
import { acceptHMRUpdate, defineStore, storeToRefs } from 'pinia'
import { computed } from 'vue'

import { getMe, signIn, signOut } from '@/api'
import router from '@/router'
import { filterMenuByRoles, resolveMenu, resolveRoute } from '@/router/helper'
import { menu } from '@/router/menu'

import { pinia } from '.'

import type { SessionUser, UserRole } from '@/api'

/**
 * 登录态 = httpOnly cookie 会话，不是 token。
 *
 * 所以这里不存 token（token 在前端手里没有意义），只持久化「当前用户 + 身份」用于 UI 决策。
 * 真正的登录态判断交给后端 /user/me：守卫里调 fetchMe 去问后端，
 * 而不是信一个可能过期的本地缓存。
 *
 * 身份缓存的副作用要说清：管理员改了某人的身份后，对方的菜单要等下一次 fetchMe（刷新页面）
 * 才更新；但接口权限是立刻生效的（后端每个请求都查 user_role），最多出现「菜单还在、点了 403」。
 * 界面便利性不值得为它再做一套实时同步。
 */
export const useUserStore = defineStore('userStore', () => {
  /**
   * 会话里的用户（session.user 形状，**不含 roles**）。
   *
   * 身份单独存在下面的 roles 里：roles 来自 user_role 关联表，不在 better-auth 的会话对象中。
   * 这里只用来渲染昵称/邮箱/头像，需要判断权限请看 roles。
   */
  const user = useStorage<SessionUser | null>('user', null)

  /** 身份集合；未登录为空数组 */
  const roles = useStorage<UserRole[]>('userRoles', [])

  /** 登录成功后是否已完成初始化（菜单是静态的，但保留这个开关便于扩展） */
  const initialized = useStorage<boolean>('initialized', false)

  /** 管理员：全量功能 */
  const isAdmin = computed(() => roles.value.includes('admin'))

  /** 作家：拥有书籍/章节接口能力（只能操作自己名下的书），但没有后台入口 */
  const isAuthor = computed(() => roles.value.includes('author'))

  /**
   * 能否进入后台：**只有管理员**。
   *
   * 后台是运营端，作家不进来——他们的能力在将来的作家端（/author 前缀）里。
   * 注意 `src/admin/` 下的接口本身也只允许管理员（后端 @Roles('admin')），所以这里拦的是
   * 「界面入口」，后端拦的是「数据入口」，两边都不能省。
   */
  const canEnterAdmin = computed(() => isAdmin.value)

  async function userSignIn(data: Parameters<typeof signIn>[0]) {
    // 登录只负责写 cookie；身份要再问一次 /user/me（登录响应里没有身份）
    const res = await signIn(data)
    user.value = res.user
    await fetchMe()
    initialized.value = true
  }

  /** 向后端确认当前登录态与身份，刷新本地缓存 */
  async function fetchMe() {
    const res = await getMe()

    user.value = res?.user ?? null
    roles.value = res?.roles ?? []
    initialized.value = res?.user != null

    return res?.user ?? null
  }

  /** 登出：清服务端会话 + 清本地缓存，回到登录页 */
  async function cleanup(redirectPath?: string) {
    // 登出失败（比如会话已过期）也不阻塞跳转，尽力而为
    try {
      await signOut()
    } catch {
      // 忽略：会话可能本就不存在
    }

    user.value = null
    roles.value = []
    initialized.value = false

    router.replace({
      name: 'signIn',
      ...(redirectPath ? { query: { r: redirectPath } } : {}),
    })

    if (router.hasRoute('layout')) {
      router.removeRoute('layout')
    }
  }

  // 菜单按身份裁剪后再解析：非管理员看不到管理菜单，管理员看到全部
  const visibleMenu = computed(() => filterMenuByRoles(menu, roles.value))
  const userMenu = computed(() => resolveMenu(visibleMenu.value))
  /**
   * 路由注册用**完整**菜单，不用裁剪后的。
   *
   * 这样「看不到」与「进不去」是两件事：菜单里不显示（filterMenuByRoles），
   * 但路由存在，手输 /user 会撞上路由守卫的 meta.roles 校验 → 落到 403，
   * 而不是因为路由未注册变成 404（那会让人以为功能没了，而不是没权限）。
   */
  const userRoute = computed(() => resolveRoute(menu))

  return {
    user,
    roles,
    initialized,
    isAdmin,
    isAuthor,
    canEnterAdmin,
    userMenu,
    userRoute,
    userSignIn,
    fetchMe,
    cleanup,
  }
})

export function toRefsUserStore() {
  return {
    ...storeToRefs(useUserStore(pinia)),
  }
}

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUserStore, import.meta.hot))
}
