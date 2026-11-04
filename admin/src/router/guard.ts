import { routerEventBus } from '@/event-bus'
import { useUserStore } from '@/stores'

import type { UserRole } from '@/api'
import type { Router } from 'vue-router'

const Layout = () => import('@/layout/index.vue')

export function setupRouterGuard(router: Router) {
  const userStore = useUserStore()

  const { cleanup, fetchMe } = userStore

  router.beforeEach(async (to, from) => {
    routerEventBus.emit({ type: 'beforeEach' })

    // 去登录页：已登录就回首页，未登录放行
    if (to.name === 'signIn') {
      if (userStore.user) {
        return from.fullPath
      }
      return
    }

    // 403 页本身不能再被权限判断拦一次，否则会自己跳自己、无限循环
    if (to.name === 'forbidden') {
      return
    }

    // 首次进入受保护页面：先向后端确认登录态与身份（菜单是静态的，注册一次即可）
    if (!router.hasRoute('layout')) {
      /**
       * 每次都问后端，而不是信 localStorage 里的 user：
       * 身份可能已被管理员改过，本地缓存只会让界面和后端不一致。
       * 一次页面加载只发生一次（layout 注册后不再进这个分支）。
       */
      const me = await fetchMe()
      if (!me) {
        cleanup(to.fullPath)
        return
      }

      // 读者能登录但没有后台权限：直接送 403，不进 layout（否则会看到空菜单）
      if (!userStore.canEnterAdmin) {
        return { name: 'forbidden' }
      }

      router.addRoute({
        path: '/',
        name: 'layout',
        component: Layout,
        redirect: '/dashboard',
        children: userStore.userRoute,
      })

      return to.fullPath
    }

    /**
     * 已有 layout 的后续导航：按菜单项的 meta.roles 再校验一次。
     * 菜单已经被 filterMenuByRoles 裁过，这里是防「手输 URL / 旧书签」绕过菜单。
     */
    const requiredRoles = to.meta.roles as UserRole[] | undefined
    if (requiredRoles?.length && !requiredRoles.some((role) => userStore.roles.includes(role))) {
      return { name: 'forbidden' }
    }
  })

  router.beforeResolve(() => {})

  router.afterEach(() => {
    routerEventBus.emit({ type: 'afterEach' })
  })
}
