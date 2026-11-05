import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, provide } from 'vue'

import { mediaQueryInjectionKey } from '@/injection'

import UserPage from '@/views/user/index.vue'

/**
 * 用户管理页的冒烟测试：确认「新增用户」按钮能把弹窗打开、且表单字段确实渲染出来。
 *
 * 之所以值得留一条：弹窗曾经用 useModal() + content 函数实现，naive-ui 在渲染函数之外
 * 调用那个 content，Vue 3.5 会告警且内容渲染不可靠。这条用例把「点按钮 → 出现可用的表单」
 * 固定下来，改成别的实现方式时能被它挡住。
 */
vi.mock('@/api', () => ({
  USER_ROLES: ['reader', 'author', 'admin'],
  ASSIGNABLE_ROLES: ['author', 'admin'],
  USER_ROLE_LABELS: { reader: '读者', author: '作家', admin: '管理员' },
  getMe: vi.fn().mockResolvedValue({ user: null, roles: [] }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  getAdminUsers: vi.fn().mockResolvedValue({
    list: [
      {
        id: 'u1',
        name: '测试读者',
        email: 'reader@example.com',
        emailVerified: false,
        image: null,
        roles: ['reader', 'admin'],
        createdAt: '2026-11-02T17:50:57.744Z',
        updatedAt: '2026-11-02T17:50:57.744Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 10,
  }),
  deleteAdminUser: vi.fn(),
  deleteAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
}))

const Host = defineComponent({
  setup() {
    provide(mediaQueryInjectionKey, {
      isMaxSm: computed(() => false),
      isMaxMd: computed(() => false),
      isMaxLg: computed(() => false),
      isMaxXl: computed(() => false),
      isMax2Xl: computed(() => false),
    })

    // NMessageProvider 是页面里 useMessage() 的前提；弹窗是声明式的，不再需要 NModalProvider
    return () => h(NMessageProvider, null, { default: () => h(UserPage) })
  },
})

describe('用户管理页', () => {
  it('点「新增用户」能打开弹窗并渲染表单', async () => {
    const wrapper = mount(Host, {
      global: { plugins: [createPinia(), PiniaColada] },
      attachTo: document.body,
    })
    await flushPromises()

    const button = wrapper.findAll('button').find((item) => item.text().includes('新增用户'))
    expect(button).toBeTruthy()

    await button!.trigger('click')
    await flushPromises()

    expect(document.body.querySelectorAll('.n-drawer')).toHaveLength(1)
    expect(document.body.textContent).toContain('昵称')
    expect(document.body.textContent).toContain('密码')
    // 身份勾选项也在弹窗里：读者固定、作家/管理员可勾
    expect(document.body.textContent).toContain('读者')

    wrapper.unmount()
  })
})
