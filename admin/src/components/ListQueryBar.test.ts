import { mount } from '@vue/test-utils'
import { NInput, NSelect } from 'naive-ui'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import ListQueryBar from './ListQueryBar.vue'

/**
 * 通用查询条的契约测试。
 *
 * 这个组件被书籍页和用户页共用，所以要把「两个页面都依赖的行为」固定住：
 * 回车与点「查询」是同一个事件、筛选值双向回传（清空时是 null 不是空串）、
 * 重置只抛事件不自己清值（清值是 useXxxQuery 的事）。
 */
const FILTER_OPTIONS: Array<{ label: string; value: 'crawl' | 'author' }> = [
  { label: '爬虫采集', value: 'crawl' },
  { label: '作家上传', value: 'author' },
]

function mountBar(props: Record<string, unknown> = {}) {
  return mount(ListQueryBar, {
    props: {
      keyword: '',
      filter: null,
      options: FILTER_OPTIONS,
      placeholder: '书名或作者',
      filterPlaceholder: '全部来源',
      ...props,
    },
  })
}

describe('ListQueryBar', () => {
  it('输入框回车触发 query 事件并回传关键字', async () => {
    const wrapper = mountBar()

    await wrapper.find('input').setValue('三体')
    await wrapper.find('input').trigger('keyup.enter')

    expect(wrapper.emitted('update:keyword')?.[0]).toEqual(['三体'])
    expect(wrapper.emitted('query')).toHaveLength(1)
  })

  it('点「查询」与回车走同一个事件', async () => {
    const wrapper = mountBar({ keyword: '三体' })

    const queryButton = wrapper.findAll('button').find((button) => button.text().includes('查询'))
    await queryButton!.trigger('click')

    expect(wrapper.emitted('query')).toHaveLength(1)
  })

  it('点「重置」只抛事件，不自己改值', async () => {
    const wrapper = mountBar({ keyword: '三体', filter: 'crawl' })

    const resetButton = wrapper.findAll('button').find((button) => button.text().includes('重置'))
    await resetButton!.trigger('click')

    expect(wrapper.emitted('reset')).toHaveLength(1)
    // 清空是 useXxxQuery.handleReset 的职责，组件不该偷偷 emit update:*
    expect(wrapper.emitted('update:keyword')).toBeUndefined()
    expect(wrapper.emitted('update:filter')).toBeUndefined()
  })

  it('筛选变化回传具体值，清空时回传 null', async () => {
    const wrapper = mountBar()

    wrapper.findComponent(NSelect).vm.$emit('update:value', 'crawl')
    await nextTick()
    expect(wrapper.emitted('update:filter')?.[0]).toEqual(['crawl'])

    wrapper.findComponent(NSelect).vm.$emit('update:value', null)
    await nextTick()
    expect(wrapper.emitted('update:filter')?.[1]).toEqual([null])
  })

  it('placeholder 与下拉选项来自 props（两个页面各自传）', () => {
    const wrapper = mountBar()

    expect(wrapper.find('input').attributes('placeholder')).toBe('书名或作者')
    expect(wrapper.findComponent(NSelect).props('options')).toEqual(FILTER_OPTIONS)
  })

  it('inputWidth 控制输入框宽度，默认 300', () => {
    // 宽度挂在 NInput 的根元素上（内部的 <input> 是撑满的，不承载宽度）
    const defaultWidth = mountBar().findComponent(NInput).element as HTMLElement
    expect(defaultWidth.style.width).toBe('300px')

    const wide = mountBar({ inputWidth: 320 }).findComponent(NInput).element as HTMLElement
    expect(wide.style.width).toBe('320px')
  })

  it('disabled 时查询按钮被禁用，但重置仍可用（用户要能清条件）', () => {
    const wrapper = mountBar({ disabled: true })

    const buttons = wrapper.findAll('button')
    const queryButton = buttons.find((button) => button.text().includes('查询'))!
    const resetButton = buttons.find((button) => button.text().includes('重置'))!

    expect(queryButton.attributes('disabled')).toBeDefined()
    expect(resetButton.attributes('disabled')).toBeUndefined()
  })
})
