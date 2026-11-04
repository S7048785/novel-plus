import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useUserStore } from './user'

/**
 * 后台准入判断的回归测试。
 *
 * 「后台只允许管理员登录」是产品规则，写在 store 里而不是路由里，所以在这里钉住：
 * 读者、作家都进不去，只有管理员能进。改这条规则时这个用例会失败，提醒同步改文档/文案。
 */
describe('userStore.canEnterAdmin', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('读者进不了后台', () => {
    const store = useUserStore()
    store.roles = ['reader']
    expect(store.canEnterAdmin).toBe(false)
  })

  it('作家进不了后台（只有接口能力）', () => {
    const store = useUserStore()
    store.roles = ['reader', 'author']
    expect(store.canEnterAdmin).toBe(false)
    // 但「是作家」这件事本身要能判断出来，403 页据此给不同解释
    expect(store.isAuthor).toBe(true)
  })

  it('管理员能进后台', () => {
    const store = useUserStore()
    store.roles = ['reader', 'admin']
    expect(store.canEnterAdmin).toBe(true)
  })

  it('作家兼管理员按管理员算', () => {
    const store = useUserStore()
    store.roles = ['reader', 'author', 'admin']
    expect(store.canEnterAdmin).toBe(true)
  })
})
