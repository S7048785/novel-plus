import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { NMessageProvider } from 'naive-ui'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { deleteAdminUser, deleteAdminUsers } from '@/api'

import { useUserSelection } from './useUserSelection'

/**
 * 选中与删除的行为测试。
 *
 * 这里最值得固定住的是 **id 类型**：用户 id 是 better-auth 的 32 位字符串，
 * 提交前必须 `String(key)`。如果抄成书籍那边的 `Number(key)`，会得到 [NaN, NaN]，
 * 后端拿到的是一次「删 0 行」的静默成功——不报错、也不删东西，最难查的那类 bug。
 */
vi.mock('@/api', () => ({
  getAdminUsers: vi.fn(),
  deleteAdminUser: vi.fn(),
  deleteAdminUsers: vi.fn(),
}))

const mockedDeleteOne = vi.mocked(deleteAdminUser)
const mockedDeleteMany = vi.mocked(deleteAdminUsers)

function mountHost() {
  let api!: ReturnType<typeof useUserSelection>

  const Child = defineComponent({
    setup() {
      api = useUserSelection()
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
  mockedDeleteOne.mockResolvedValue({ id: 'u1', deleted: 1 })
  mockedDeleteMany.mockResolvedValue({ deleted: 2, ids: ['u1', 'u2'] })
})

describe('useUserSelection', () => {
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

  it('批量删除提交字符串 id（不是数字），成功后清空选中', async () => {
    const api = mountHost()
    api.checkedRowKeys.value = ['u1', 'u2']

    api.handleBatchDelete()
    await vi.waitFor(() =>
      expect(mockedDeleteMany).toHaveBeenCalledWith(['u1', 'u2'], expect.anything()),
    )

    // 明确断言不是 NaN：写成 Number(key) 时这里会变成 [NaN, NaN]
    expect(mockedDeleteMany.mock.calls[0]?.[0]).toEqual(['u1', 'u2'])

    await flushPromises()
    await vi.waitFor(() => expect(api.checkedRowKeys.value).toEqual([]))
    expect(api.hasSelection.value).toBe(false)
  })

  it('单条删除后只剔除该行，其余选中保留', async () => {
    const api = mountHost()
    api.checkedRowKeys.value = ['u1', 'u2', 'u3']

    api.mutateDeleteUser('u1')
    await vi.waitFor(() => expect(mockedDeleteOne).toHaveBeenCalledWith('u1', expect.anything()))

    await flushPromises()
    await vi.waitFor(() => expect(api.checkedRowKeys.value).toEqual(['u2', 'u3']))
  })

  it('删除请求进行中时 loading 为 true（按钮禁用态依赖它）', async () => {
    let resolveDelete: (value: { id: string; deleted: number }) => void = () => {}
    mockedDeleteOne.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve
      }),
    )

    const api = mountHost()
    api.mutateDeleteUser('u1')

    await vi.waitFor(() => expect(api.loading.value).toBe(true))

    resolveDelete({ id: 'u1', deleted: 1 })
    await vi.waitFor(() => expect(api.loading.value).toBe(false))
  })
})
