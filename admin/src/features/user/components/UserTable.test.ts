import { enableAutoUnmount, mount } from '@vue/test-utils'
import { NDataTable, NPopconfirm } from 'naive-ui'
import { afterEach, describe, expect, it } from 'vitest'
import { computed, nextTick } from 'vue'

import { mediaQueryInjectionKey } from '@/injection'

import UserTable from './UserTable.vue'

import type { AdminUser } from '@/api'
import type { DataTableColumns } from 'naive-ui'

// 表格内部会挂 ResizeObserver，测试结束不卸载会在 jsdom 销毁时留下异步告警
enableAutoUnmount(afterEach)

/**
 * 用户表格的契约测试。
 *
 * 除了与书籍表格相同的几项（scroll-x、固定列、checked-row-keys 双向），
 * 这里多一条**只有用户表才有**的规则：自己那一行不能删，身份列还要标「我」。
 * 这条规则原来写在页面的 CellActions 里，搬到表格后必须仍然成立。
 */
const selfUser: AdminUser = {
  id: 'u-self',
  name: '当前管理员',
  email: 'me@example.com',
  emailVerified: true,
  image: null,
  roles: ['reader', 'admin'],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
}

const otherUser: AdminUser = {
  ...selfUser,
  id: 'u-other',
  name: '另一个作家',
  email: 'other@example.com',
  roles: ['reader', 'author'],
}

function mountTable(selfId?: string) {
  return mount(UserTable, {
    props: {
      data: [selfUser, otherUser],
      loading: false,
      pagination: { page: 1, pageSize: 10, itemCount: 2 },
      checkedRowKeys: [],
      selfId,
    },
    global: {
      provide: {
        [mediaQueryInjectionKey as symbol]: {
          isMaxSm: computed(() => false),
          isMaxMd: computed(() => false),
          isMaxLg: computed(() => false),
          isMaxXl: computed(() => false),
          isMax2Xl: computed(() => false),
        },
      },
    },
  })
}

/** 找出某一行的「删除」按钮 */
function deleteButtonOf(wrapper: ReturnType<typeof mountTable>, rowIndex: number) {
  const row = wrapper.findAll('tbody tr')[rowIndex]
  return row!.findAll('button').find((button) => button.text().includes('删除'))
}

describe('UserTable', () => {
  it('表格宽度取列宽之和，并开启 remote / flex-height', () => {
    const wrapper = mountTable()
    const table = wrapper.findComponent(NDataTable)

    expect(table.props('scrollX')).toBe(1400)
    expect(table.props('remote')).toBe(true)
    expect(table.props('flexHeight')).toBe(true)
    expect(table.props('data')).toHaveLength(2)
  })

  it('操作列固定在右侧，首列是选择列', () => {
    const wrapper = mountTable()
    const columns = wrapper.findComponent(NDataTable).props('columns') as DataTableColumns<AdminUser>

    const shaped = columns as Array<{ key?: string; fixed?: string; type?: string }>
    expect(shaped.find((column) => column.key === 'actions')?.fixed).toBe('right')
    expect(shaped[0]?.type).toBe('selection')
  })

  it('自己那一行的删除按钮被禁用，别人那行可点', () => {
    const wrapper = mountTable('u-self')

    expect(deleteButtonOf(wrapper, 0)!.attributes('disabled')).toBeDefined()
    expect(deleteButtonOf(wrapper, 1)!.attributes('disabled')).toBeUndefined()
  })

  it('身份列给自己那行加「我」标签', () => {
    const wrapper = mountTable('u-self')
    const rows = wrapper.findAll('tbody tr')

    expect(rows[0]!.text()).toContain('我')
    expect(rows[0]!.text()).toContain('管理员')
    expect(rows[1]!.text()).not.toContain('我')
  })

  it('选中变化会往父级抛 update:checkedRowKeys', async () => {
    const wrapper = mountTable()
    const table = wrapper.findComponent(NDataTable)

    table.vm.$emit('update:checkedRowKeys', ['u-other'])
    await nextTick()

    expect(wrapper.emitted('update:checkedRowKeys')?.[0]).toEqual([['u-other']])
  })

  it('操作列抛 edit 事件；删除经确认后抛 delete', async () => {
    const wrapper = mountTable('u-self')

    const editButton = wrapper
      .findAll('tbody tr')[1]!
      .findAll('button')
      .find((button) => button.text().includes('编辑'))!
    await editButton.trigger('click')
    expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({ id: 'u-other' })

    await deleteButtonOf(wrapper, 1)!.trigger('click')
    // 只有别人那一行有 Popconfirm（自己那行是禁用按钮），直接调确认回调比点弹出层稳
    const confirm = wrapper.findComponent(NPopconfirm).props('onPositiveClick') as
      | (() => void)
      | undefined
    expect(confirm).toBeTypeOf('function')
    confirm!()
    expect(wrapper.emitted('delete')?.[0]?.[0]).toMatchObject({ id: 'u-other' })
  })
})
