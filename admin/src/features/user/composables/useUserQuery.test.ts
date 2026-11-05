import { PiniaColada, useQueryCache } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'

import { getAdminUsers } from '@/api'

import { useUserQuery } from './useUserQuery'

/**
 * 查询状态的行为测试（结构与 useBookQuery.test.ts 对应）。
 *
 * 与书籍页的区别只有筛选字段（role 而不是 origin），但这里仍然单独测一遍：
 * 两处逻辑是复制出来的，将来改一处忘另一处时，只有各自的测试能挡住。
 */
vi.mock('@/api', () => ({
  getAdminUsers: vi.fn(),
  deleteAdminUser: vi.fn(),
  deleteAdminUsers: vi.fn(),
}))

const mockedGetUsers = vi.mocked(getAdminUsers)

function mountHost() {
  let api!: ReturnType<typeof useUserQuery>
  let cache!: ReturnType<typeof useQueryCache>

  mount(
    defineComponent({
      setup() {
        api = useUserQuery()
        cache = useQueryCache()
        return () => null
      },
    }),
    { global: { plugins: [createPinia(), PiniaColada] } },
  )

  return { api, cache }
}

beforeEach(() => {
  mockedGetUsers.mockReset()
  mockedGetUsers.mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 10 })
})

describe('useUserQuery', () => {
  it('首次请求用默认分页，query key 与请求参数同源', async () => {
    const { cache } = mountHost()

    await vi.waitFor(() => expect(mockedGetUsers).toHaveBeenCalled())
    expect(mockedGetUsers).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 10,
      keyword: undefined,
      role: undefined,
    })

    const entry = cache.getEntries().find((e) => e.key[0] === 'adminUsers')
    expect(entry?.key).toEqual(['adminUsers', 1, 10, '', null])
  })

  it('条件没变时手动 refetch；条件变了只发一次请求', async () => {
    const { api } = mountHost()
    await vi.waitFor(() => expect(mockedGetUsers).toHaveBeenCalledTimes(1))

    api.handleQuery()
    await vi.waitFor(() => expect(mockedGetUsers).toHaveBeenCalledTimes(2))

    api.keywordInput.value = ' admin@example.com '
    api.handleQuery()
    await vi.waitFor(() => expect(mockedGetUsers).toHaveBeenCalledTimes(3))

    await flushPromises()
    expect(mockedGetUsers).toHaveBeenCalledTimes(3)
    // 前后空格 trim 掉再进 query
    expect(mockedGetUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'admin@example.com' }),
    )
  })

  it('查询时把页码归 1', async () => {
    const { api } = mountHost()
    await vi.waitFor(() => expect(mockedGetUsers).toHaveBeenCalledTimes(1))

    api.pagination.page = 4
    api.keywordInput.value = '张三'
    api.handleQuery()

    expect(api.pagination.page).toBe(1)
    expect(api.keyword.value).toBe('张三')
  })

  it('切换身份筛选后回到第一页', async () => {
    const { api } = mountHost()
    await vi.waitFor(() => expect(mockedGetUsers).toHaveBeenCalledTimes(1))

    api.pagination.page = 3
    api.roleFilter.value = 'admin'
    await nextTick()

    expect(api.pagination.page).toBe(1)
  })

  it('重置清空关键字与身份筛选，并回到第一页', async () => {
    const { api } = mountHost()
    await vi.waitFor(() => expect(mockedGetUsers).toHaveBeenCalledTimes(1))

    api.keywordInput.value = '张三'
    api.keyword.value = '张三'
    api.roleFilter.value = 'author'
    api.pagination.page = 2

    api.handleReset()

    expect(api.keywordInput.value).toBe('')
    expect(api.keyword.value).toBe('')
    expect(api.roleFilter.value).toBeNull()
    expect(api.pagination.page).toBe(1)
  })

  it('列表总数同步给分页器', async () => {
    mockedGetUsers.mockResolvedValue({ list: [], total: 7, page: 1, pageSize: 10 })
    const { api } = mountHost()

    await vi.waitFor(() => expect(api.pagination.itemCount).toBe(7))
  })
})
