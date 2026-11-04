import { createRouter, createWebHistory } from 'vue-router'

import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/sign-in', name: 'signIn', component: () => import('@/views/sign-in/index.vue') },
  // 403 不走菜单（菜单是「有权限才出现」），必须静态注册：读者登录后就是被送到这里
  { path: '/403', name: 'forbidden', component: () => import('@/views/error-page/403.vue') },
  {
    path: '/:pathMatch(.*)*',
    name: 'errorPage',
    component: () => import('@/views/error-page/index.vue'),
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  strict: true,
})

export default router
