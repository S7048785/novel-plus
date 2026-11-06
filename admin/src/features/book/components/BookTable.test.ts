import { enableAutoUnmount, mount } from '@vue/test-utils'
import { NDataTable, NPopconfirm } from 'naive-ui'
import { afterEach, describe, expect, it } from 'vitest'
import { computed, nextTick } from 'vue'

import { mediaQueryInjectionKey } from '@/injection'

import BookTable from './BookTable.vue'

import type { AdminBook } from '@/api'
import type { DataTableColumns } from 'naive-ui'

// 表格内部会挂 ResizeObserver，测试结束不卸载会在 jsdom 销毁时留下异步告警
enableAutoUnmount(afterEach)

/**
 * 表格的契约测试。
 *
 * 表格是这次拆分的最高风险项，因为它同时依赖三件容易在重构中丢掉的事：
 * 1. `scroll-x` 必须等于列宽之和（少了固定列就不会横向滚动，只会压扁换行）；
 * 2. `checked-row-keys` 是受控双向绑定，漏一边就会出现「勾了但父级不知道」；
 * 3. 首列与操作列各自 emit 什么事件（父级靠这个做跳转/弹窗/删除）。
 */
const row: AdminBook = {
  id: 7,
  name: '测试书籍',
  author: '测试作者',
  coverUrl: null,
  bookUrl: null,
  sourceId: null,
  sourceName: null,
  wordCount: '10 万',
  latestChapterTitle: '第 1 章',
  totalChapterNum: 2,
  tocUrl: null,
  intro: null,
  origin: 'manual',
  authorId: null,
  authorName: null,
  chapterCount: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
}

function mountTable() {
  return mount(BookTable, {
    props: {
      data: [row],
      loading: false,
      pagination: { page: 1, pageSize: 10, itemCount: 1 },
      checkedRowKeys: [],
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

describe('BookTable', () => {
  it('表格宽度取列宽之和，并开启 remote / flex-height', () => {
    const wrapper = mountTable()
    const table = wrapper.findComponent(NDataTable)

    // 1430 = selection + 8 个数据列 + 170 的操作列，改了列宽必须同步 constants.ts
    expect(table.props('scrollX')).toBe(1430)
    expect(table.props('remote')).toBe(true)
    expect(table.props('flexHeight')).toBe(true)
    expect(table.props('data')).toHaveLength(1)
  })

  it('操作列固定在右侧', () => {
    const wrapper = mountTable()
    const columns = wrapper.findComponent(NDataTable).props('columns') as DataTableColumns<AdminBook>

    // 列是联合类型（selection 列没有 key），这里只关心两个字段，直接按结构取
    const shaped = columns as Array<{ key?: string; fixed?: string; type?: string }>
    const actions = shaped.find((column) => column.key === 'actions')

    expect(actions?.fixed).toBe('right')
    expect(shaped[0]?.type).toBe('selection')
  })

  it('选中变化会往父级抛 update:checkedRowKeys（受控双向绑定）', async () => {
    const wrapper = mountTable()
    const table = wrapper.findComponent(NDataTable)

    table.vm.$emit('update:checkedRowKeys', [7])
    await nextTick()

    expect(wrapper.emitted('update:checkedRowKeys')?.[0]).toEqual([[7]])
  })

  it('点书名抛 edit；操作列只剩章节与删除', async () => {
    const wrapper = mountTable()

    const buttons = wrapper.findAll('button').map((button) => button.text())
    expect(buttons).toContain('章节')
    expect(buttons).toContain('删除')
    // 「编辑」按钮已移除，编辑入口是首列；写在这里是为了防止重构时又加回去
    expect(buttons).not.toContain('编辑')

    // 首列点书名 → edit（title 属性带完整书名，也能当 tooltip）
    const nameCell = wrapper.find('span[title="测试书籍"]')
    expect(nameCell.exists()).toBe(true)
    await nameCell.trigger('click')
    expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({ id: 7 })

    await wrapper.findAll('button').find((button) => button.text().includes('章节'))!.trigger('click')
    expect(wrapper.emitted('chapters')?.[0]?.[0]).toMatchObject({ id: 7 })

    // 删除按钮包在 NPopconfirm 里，确认后才 emit（直接调它的 onPositiveClick，
    // 比点 DOM 更稳：弹出层是懒渲染的，类名也随主题变）
    const confirm = wrapper.findComponent(NPopconfirm).props('onPositiveClick') as
      | (() => void)
      | undefined
    expect(confirm).toBeTypeOf('function')
    confirm!()
    expect(wrapper.emitted('delete')?.[0]?.[0]).toMatchObject({ id: 7 })
  })

  it('loading 会传给表格与分页器', () => {
    const wrapper = mount(BookTable, {
      props: {
        data: [],
        loading: true,
        pagination: { page: 1, pageSize: 10, itemCount: 0 },
        checkedRowKeys: [],
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

    expect(wrapper.findComponent(NDataTable).props('loading')).toBe(true)
  })
})
