import { describe, expect, it } from 'vitest'

import { resolveRoute } from '@/router/helper'
import { menu } from '@/router/menu'

import type { RouteRecordRaw } from 'vue-router'

/**
 * 菜单 → 路由的解析测试。
 *
 * 这条用例盯的是一个**编译期不会报错**的坑：`resolveRoute` 用
 * `import.meta.glob('@/views/**\/*.vue', '@/features/**\/pages/**\/*.vue')` 找组件，
 * menu 里写的 `component: 'crawl/source/index'` 一旦对不上实际文件路径，
 * 页面不会构建失败，只会在运行时 404（菜单点得开、内容空白）。
 *
 * 所以断言的是「解析出来的路由确实拿到了 component」，而不是只断言菜单结构。
 */
function flatten(
  routes: RouteRecordRaw[],
  base = '',
): Array<{ path: string; route: RouteRecordRaw }> {
  return routes.flatMap((route) => {
    const path = [base, route.path].filter(Boolean).join('/')
    return [{ path, route }, ...flatten(route.children ?? [], path)]
  })
}

const resolved = flatten(resolveRoute(menu))

describe('菜单与路由', () => {
  it('书源管理挂在「爬虫管理」下，且能解析到真实组件', () => {
    const found = resolved.find((item) => item.route.name === 'crawlSource')

    expect(found).toBeTruthy()
    expect(found!.path).toBe('crawl/source')
    // glob 没匹配到文件时这里是 undefined —— 正是要拦的情况
    expect(found!.route.component).toBeTruthy()
  })

  it('爬虫管理是一级菜单，且默认重定向到书源管理', () => {
    const crawl = menu.find((item) => 'name' in item && item.name === 'crawl')

    expect(crawl).toBeTruthy()
    expect('children' in crawl! && crawl!.children).toHaveLength(1)
    expect('redirect' in crawl! && crawl!.redirect).toBe('crawl/source')
  })
})
