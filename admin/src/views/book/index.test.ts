import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, provide } from 'vue'

import { mediaQueryInjectionKey } from '@/injection'

import BookPage from './index.vue'

/**
 * 书籍管理页冒烟测试：确认列表渲染、点「新增书籍」能打开弹窗并渲染表单。
 *
 * 值得留一条的理由与用户管理页相同——弹窗是手写的表单组件，字段多、条件分支多（新增/编辑
 * 显示的字段不同），一条「能打开且关键字段在」的用例能挡住整块模板被改坏。
 */
vi.mock('@/api', () => ({
  BOOK_ORIGINS: ['crawl', 'author', 'manual'],
  BOOK_ORIGIN_LABELS: { crawl: '爬虫采集', author: '作家上传', manual: '手动导入' },
  getAdminBooks: vi.fn().mockResolvedValue({
    list: [
      {        id: 1,
        name: '1984：从破产川菜馆开始',
        author: '轻语江湖',
        coverUrl: null,
        bookUrl: 'https://example.com/46',
        sourceId: 15,
        sourceName: '笔趣阁',
        wordCount: '25.9 万',
        latestChapterTitle: '第 66 章',
        totalChapterNum: 66,
        tocUrl: null,
        intro: '简介',
        origin: 'crawl',
        authorId: null,
        authorName: null,
        chapterCount: 66,
        createdAt: '2026-11-02T17:50:57.744Z',
        updatedAt: '2026-11-02T17:50:57.744Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 10,
  }),
  deleteAdminBook: vi.fn(),
  deleteAdminBooks: vi.fn(),
  createAdminBook: vi.fn(),
  updateAdminBook: vi.fn(),
  // 列表页会拉一次作家候选（归属下拉 / 筛选下拉共用）
  getAdminUsers: vi.fn().mockResolvedValue({
    list: [{ id: 'u1', name: '测试作家', email: 'a@b.c', emailVerified: false, image: null, roles: ['reader', 'author'], createdAt: '', updatedAt: '' }],
    total: 1,
    page: 1,
    pageSize: 100,
  }),
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

    return () => h(NMessageProvider, null, { default: () => h(BookPage) })
  },
})

describe('书籍管理页', () => {
  it('渲染列表并能打开新增弹窗', async () => {
    const wrapper = mount(Host, {
      global: { plugins: [createPinia(), PiniaColada] },
      attachTo: document.body,
    })
    await flushPromises()

    // 列表数据来自 mock，书名应出现在表格里
    expect(document.body.textContent).toContain('1984：从破产川菜馆开始')

    const button = wrapper.findAll('button').find((item) => item.text().includes('新增书籍'))
    expect(button).toBeTruthy()

    await button!.trigger('click')
    await flushPromises()

    expect(document.body.querySelectorAll('.n-drawer')).toHaveLength(1)
    // 新增态应出现来源相关字段（编辑态是只读展示，没有这两个输入框）
    expect(document.body.textContent).toContain('源站地址')
    expect(document.body.textContent).toContain('目录页')
    expect(document.body.textContent).toContain('总章数')
    // 入库方式是可选项，三种取值都要能选
    expect(document.body.textContent).toContain('入库方式')

    wrapper.unmount()
  })
})
