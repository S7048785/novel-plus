import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, provide } from 'vue'

import { mediaQueryInjectionKey } from '@/injection'

import ChapterManage from './ChapterManage.vue'

/**
 * 章节管理页冒烟测试：确认按路由里的 bookId 拉到书与章节、点「新增章节」能打开抽屉。
 *
 * 路由参数用 mock 提供（页面只依赖 useRoute/useRouter 两个 API），
 * 这样不必为一条冒烟测试搭一个真实的 router 实例。
 */
/**
 * 只替换 useRoute / useRouter，其余（createRouter 等）保留真实实现：
 * 页面通过 @/stores 间接引入了真实的 router 实例，全量 mock 会让那个模块加载就炸。
 */
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => ({ params: { bookId: '1' } }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  }
})

vi.mock('@/api', () => ({
  getAdminBook: vi.fn().mockResolvedValue({
    id: 1,
    name: '1984：从破产川菜馆开始',
    author: '轻语江湖',
    coverUrl: null,
    bookUrl: 'https://example.com/46',
    sourceId: 15,
    sourceName: '笔趣阁',
    wordCount: '25.9 万',
    latestChapterTitle: '第 2 章',
    totalChapterNum: 66,
    tocUrl: null,
    intro: '简介',
    origin: 'crawl',
    authorId: null,
    authorName: null,
    chapterCount: 2,
    createdAt: '2026-11-02T17:50:57.744Z',
    updatedAt: '2026-11-02T17:50:57.744Z',
  }),
  getAdminChapters: vi.fn().mockResolvedValue({
    list: [
      {
        id: 11,
        bookId: 1,
        title: '第 1 章 开局',
        url: 'https://example.com/46/1',
        index: 1,
        contentLength: 2314,
        createdAt: '2026-11-02T17:50:57.744Z',
        updatedAt: '2026-11-02T17:50:57.744Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 50,
  }),
  getAdminChapter: vi.fn(),
  createAdminChapter: vi.fn(),
  updateAdminChapter: vi.fn(),
  deleteAdminChapter: vi.fn(),
  deleteAdminChapters: vi.fn(),
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

    return () => h(NMessageProvider, null, { default: () => h(ChapterManage) })
  },
})

describe('章节管理页', () => {
  it('按 bookId 渲染书名与章节列表，并能打开新增抽屉', async () => {
    const wrapper = mount(Host, {
      global: { plugins: [createPinia(), PiniaColada] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(document.body.textContent).toContain('1984：从破产川菜馆开始')
    expect(document.body.textContent).toContain('第 1 章 开局')
    // 正文字数与源站标称章数都要展示，避免把「落库章节数」和「源站标称」搞混
    expect(document.body.textContent).toContain('2314')
    expect(document.body.textContent).toContain('源站标称 66 章')

    const button = wrapper.findAll('button').find((item) => item.text().includes('新增章节'))
    expect(button).toBeTruthy()

    await button!.trigger('click')
    await flushPromises()

    expect(document.body.querySelectorAll('.n-drawer')).toHaveLength(1)
    expect(document.body.textContent).toContain('章节标题')
    expect(document.body.textContent).toContain('正文')

    wrapper.unmount()
  })
})
