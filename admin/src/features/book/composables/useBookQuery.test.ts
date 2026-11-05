import { PiniaColada, useQueryCache } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'

import { getAdminBooks } from '@/api'

import { useBookQuery } from './useBookQuery'

/**
 * 查询状态的行为测试。
 *
 * 这一层最容易出错的是三处，正好各一条：
 * 1. query key 与请求参数同源（不同源会出现「key 变了、请求还是旧的」）；
 * 2. 查询时把页码归 1（停在旧页码会看到空列表）；
 * 3. 「条件没变才手动 refetch」——条件变了再 refetch 会一次点击发两个请求。
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

const mockedGetBooks = vi.mocked(getAdminBooks)

/** composable 要在 setup 里跑（useQuery 依赖 effectScope），所以挂一个空宿主组件 */
function mountHost() {
  let api!: ReturnType<typeof useBookQuery>
  let cache!: ReturnType<typeof useQueryCache>

  mount(
    defineComponent({
      setup() {
        api = useBookQuery()
        cache = useQueryCache()
        return () => null
      },
    }),
    { global: { plugins: [createPinia(), PiniaColada] } },
  )

  return { api, cache }
}

beforeEach(() => {
  mockedGetBooks.mockReset()
  mockedGetBooks.mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 10 })
})

describe('useBookQuery', () => {
  it('首次请求用默认分页，且 query key 与请求参数同源', async () => {
    const { cache } = mountHost()

    await vi.waitFor(() => expect(mockedGetBooks).toHaveBeenCalled())
    expect(mockedGetBooks).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 10,
      keyword: undefined,
      origin: undefined,
    })

    const entry = cache.getEntries().find((e) => e.key[0] === 'adminBooks')
    // 空关键字用 '' 、空筛选用 null 占位：EntryKey 必须是可序列化的值，不能是 undefined
    expect(entry?.key).toEqual(['adminBooks', 1, 10, '', null])
  })

  it('翻页后按新页码请求，key 跟着变', async () => {
    const { api, cache } = mountHost()
    await vi.waitFor(() => expect(mockedGetBooks).toHaveBeenCalledTimes(1))

    api.pagination.page = 2
    await vi.waitFor(() =>
      expect(mockedGetBooks).toHaveBeenLastCalledWith({
        page: 2,
        pageSize: 10,
        keyword: undefined,
        origin: undefined,
      }),
    )

    const keys = cache.getEntries().map((e) => e.key)
    expect(keys).toContainEqual(['adminBooks', 2, 10, '', null])
  })

  it('查询时把页码归 1，并把输入框的值提交成生效关键字', async () => {
    const { api } = mountHost()
    await vi.waitFor(() => expect(mockedGetBooks).toHaveBeenCalledTimes(1))

    api.pagination.page = 3
    api.keywordInput.value = '  三体  '
    api.handleQuery()

    expect(api.pagination.page).toBe(1)
    // 前后空格要被 trim 掉，否则会拿着空格去匹配
    expect(api.keyword.value).toBe('三体')
  })

  it('条件没变时手动 refetch；条件变了只发一次请求', async () => {
    const { api } = mountHost()
    await vi.waitFor(() => expect(mockedGetBooks).toHaveBeenCalledTimes(1))

    // 重复点查询（关键字与页码都没变）：走 refetch，再发一次
    api.handleQuery()
    await vi.waitFor(() => expect(mockedGetBooks).toHaveBeenCalledTimes(2))

    // 关键字变了：key 变化会自动请求，不能再 refetch 一次（否则一次点击两个请求）
    api.keywordInput.value = '三体'
    api.handleQuery()
    await vi.waitFor(() => expect(mockedGetBooks).toHaveBeenCalledTimes(3))

    await flushPromises()
    expect(mockedGetBooks).toHaveBeenCalledTimes(3)
  })

  it('切换入库方式筛选后回到第一页', async () => {
    const { api } = mountHost()
    await vi.waitFor(() => expect(mockedGetBooks).toHaveBeenCalledTimes(1))

    api.pagination.page = 3
    api.originFilter.value = 'crawl'
    await nextTick()

    expect(api.pagination.page).toBe(1)
  })

  it('重置清空关键字与筛选，并回到第一页', async () => {
    const { api } = mountHost()
    await vi.waitFor(() => expect(mockedGetBooks).toHaveBeenCalledTimes(1))

    api.keywordInput.value = '三体'
    api.keyword.value = '三体'
    api.originFilter.value = 'manual'
    api.pagination.page = 5

    api.handleReset()

    expect(api.keywordInput.value).toBe('')
    expect(api.keyword.value).toBe('')
    expect(api.originFilter.value).toBeNull()
    expect(api.pagination.page).toBe(1)
  })

  it('列表总数同步给分页器', async () => {
    mockedGetBooks.mockResolvedValue({ list: [], total: 42, page: 1, pageSize: 10 })
    const { api } = mountHost()

    await vi.waitFor(() => expect(api.pagination.itemCount).toBe(42))
  })
})
