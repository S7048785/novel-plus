import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { deleteAdminBook, deleteAdminBooks } from '@/api'

import { useBookSelection } from './useBookSelection'

/**
 * 选中与删除的行为测试。
 *
 * 重点两条：
 * - 批量删除成功后选中要清空（否则按钮还显示「已选 N」，但列表里已经没有那些行）；
 * - 单条删除要把该行从选中里剔除（同样的残留问题，只是数量为 1）。
 */
vi.mock('@/api', () => ({
  BOOK_ORIGIN_LABELS: { crawl: '爬虫采集', author: '作家上传', manual: '手动导入' },
  getAdminBook: vi.fn(),
  getAdminBooks: vi.fn(),
  getAdminChapter: vi.fn(),
  getAdminChapters: vi.fn(),
  getAdminUsers: vi.fn(),
  deleteAdminBook: vi.fn(),
  deleteAdminBooks: vi.fn(),
  deleteAdminChapter: vi.fn(),
  deleteAdminChapters: vi.fn(),
}))

const mockedDeleteOne = vi.mocked(deleteAdminBook)
const mockedDeleteMany = vi.mocked(deleteAdminBooks)

/** useMessage 要求 NMessageProvider 祖先，所以 composable 要在 provider 的子树里跑 */
function mountHost() {
  let api!: ReturnType<typeof useBookSelection>

  const Child = defineComponent({
    setup() {
      api = useBookSelection()
      return () => null
    },
  })

  mount(
    defineComponent({
      setup: () => () => h(NMessageProvider, null, { default: () => h(Child) }),
    }),
    { global: { plugins: [createPinia(), PiniaColada] } },
  )

  return api
}

beforeEach(() => {
  mockedDeleteOne.mockReset()
  mockedDeleteMany.mockReset()
  mockedDeleteOne.mockResolvedValue({ id: 1, deleted: 1 })
  mockedDeleteMany.mockResolvedValue({ deleted: 2, ids: [1, 2] })
})

describe('useBookSelection', () => {
  it('初始没有选中，hasSelection 为 false', () => {
    const api = mountHost()

    expect(api.checkedRowKeys.value).toEqual([])
    expect(api.hasSelection.value).toBe(false)
  })

  it('空选中时点批量删除不发请求', () => {
    const api = mountHost()

    api.handleBatchDelete()

    expect(mockedDeleteMany).not.toHaveBeenCalled()
  })

  it('批量删除按 id 数组提交，成功后清空选中', async () => {
    const api = mountHost()
    api.checkedRowKeys.value = [1, 2]

    api.handleBatchDelete()
    await vi.waitFor(() => expect(mockedDeleteMany).toHaveBeenCalledWith([1, 2], expect.anything()))

    // 选中里是 row key（string | number），提交前统一转成 number
    expect(mockedDeleteMany.mock.calls[0]?.[0]).toEqual([1, 2])

    await flushPromises()
    await vi.waitFor(() => expect(api.checkedRowKeys.value).toEqual([]))
    expect(api.hasSelection.value).toBe(false)
  })

  it('单条删除后只剔除该行，其余选中保留', async () => {
    const api = mountHost()
    api.checkedRowKeys.value = [1, 2, 3]

    api.mutateDeleteBook(1)
    await vi.waitFor(() => expect(mockedDeleteOne).toHaveBeenCalledWith(1, expect.anything()))

    await flushPromises()
    await vi.waitFor(() => expect(api.checkedRowKeys.value).toEqual([2, 3]))
  })

  it('删除请求进行中时 loading 为 true（按钮禁用态依赖它）', async () => {
    let resolveDelete: (value: { id: number; deleted: number }) => void = () => {}
    mockedDeleteOne.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve
      }),
    )

    const api = mountHost()
    api.mutateDeleteBook(1)

    await vi.waitFor(() => expect(api.loading.value).toBe(true))

    resolveDelete({ id: 1, deleted: 1 })
    await vi.waitFor(() => expect(api.loading.value).toBe(false))
  })
})
