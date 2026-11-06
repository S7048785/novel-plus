<script setup lang="tsx">
import { NButton, NDataTable, NEllipsis, NPagination, NPopconfirm, NSwitch, NTag } from 'naive-ui'
import { computed } from 'vue'

import { useComponentModifier, useInjection } from '@/composables'
import { SOURCE_STATUS_LABELS, SOURCE_STATUS_TAG_TYPE, TABLE_SCROLL_X } from '@/features/crawl/constants'
import { mediaQueryInjectionKey } from '@/injection'
import { formatDateTime } from '@/utils/format'

import type { AdminBookSource } from '@/api'
import type { DataTableColumns, PaginationProps } from 'naive-ui'

/**
 * 书源列表表格（含分页器）。
 *
 * 拆出来的理由同 BookTable：纯展示 + 事件上抛，没有自己的状态——
 * 选中行、分页值都由父级持有，表格只负责「怎么画」和「点了什么」。
 */
const props = defineProps<{
  data: AdminBookSource[]
  /** 列表/删除/开关请求进行中：表格 loading + 分页器禁用 */
  loading: boolean
  pagination: PaginationProps
}>()

const emit = defineEmits<{
  edit: [source: AdminBookSource]
  test: [source: AdminBookSource]
  delete: [source: AdminBookSource]
  /** 行内启用开关：值由父级决定是否提交（父级做 loading 与提示） */
  toggle: [source: AdminBookSource, enabled: boolean]
}>()

/**
 * 选中行。用 defineModel 而不是 props + emit 手写：
 * NDataTable 的 checked-row-keys 是受控的，任一方向漏了都会出现「勾选后父级拿不到」。
 */
const checkedRowKeys = defineModel<Array<string | number>>('checkedRowKeys', { required: true })

const { isMaxMd, isMaxLg } = useInjection(mediaQueryInjectionKey)

const { getPopconfirmModifier } = useComponentModifier()

/** 提到外面而不是写在模板里：内联函数每次渲染都是新引用，会让表格判定 row-key 变化 */
const rowKey = (row: AdminBookSource) => row.id

const columns = computed<DataTableColumns<AdminBookSource>>(() => [
  {
    type: 'selection',
    options: ['all', 'none'],
  },
  {
    key: 'sourceName',
    title: '书源名称',
    width: 220,
    /**
     * 首列就是编辑入口：点名称直接打开编辑抽屉。
     *
     * 不用 NButton 而是 span：naive-ui 的 text button 内部是 inline-flex 容器，
     * 嵌进固定宽度的单元格后 truncate 不生效（长名称会撑破列）。
     * 用 span + w-full 则直接吃到单元格宽度，配合 title 提供完整名称的原生 tooltip。
     */
    render: (row) => (
      <span
        class='block w-full cursor-pointer truncate text-left transition-[color] hover:text-primary hover:underline'
        title={row.sourceName}
        onClick={() => emit('edit', row)}
      >
        {row.sourceName}
      </span>
    ),
  },
  {
    key: 'sourceUrl',
    title: '站点地址',
    width: 320,
    // 书源地址是站点根地址，管理员经常要点开确认站点是否还活着，所以做成可点链接
    render: (row) => (
      <NEllipsis tooltip>
        <a
          href={row.sourceUrl}
          target='_blank'
          rel='noreferrer noopener'
          class='underline decoration-dotted underline-offset-2'
        >
          {row.sourceUrl}
        </a>
      </NEllipsis>
    ),
  },
  {
    key: 'enabled',
    title: '启用',
    width: 90,
    align: 'center',
    render: (row) => (
      <NSwitch
        value={row.enabled}
        size='small'
        loading={props.loading}
        disabled={props.loading}
        onUpdateValue={(value: boolean) => emit('toggle', row, value)}
      />
    ),
  },
  {
    key: 'status',
    title: '运行状态',
    width: 100,
    align: 'center',
    render: (row) => (
      <NTag bordered={false} size='small' type={SOURCE_STATUS_TAG_TYPE[row.status] ?? 'default'}>
        {SOURCE_STATUS_LABELS[row.status] ?? `未知(${row.status})`}
      </NTag>
    ),
  },
  {
    key: 'updatedAt',
    title: '更新时间',
    width: 190,
    render: (row) => formatDateTime(row.updatedAt),
  },
  {
    key: 'actions',
    title: '操作',
    width: 150,
    align: 'center',
    fixed: 'right',
    render: (row) => cellActions(row),
  },
])

/**
 * 操作列只有「测试」和「删除」：编辑入口移到了首列（点书源名称）。
 *
 * 用普通函数而不是内联 JSX：两个按钮都要 emit，写在 columns 的 render 里会让 computed 每次求值
 * 都重建一遍整棵子树，肉眼看不出来但会拖慢大表格的重渲染。
 */
const cellActions = (row: AdminBookSource) => (
  <div class='flex justify-end gap-2'>
    <NButton
      secondary
      size='small'
      onClick={() => emit('test', row)}
    >
      测试
    </NButton>
    <NPopconfirm
      {...getPopconfirmModifier()}
      positiveText='确定'
      negativeText='取消'
      onPositiveClick={() => emit('delete', row)}
    >
      {{
        default: () => '删除书源不会删除已采集的书籍，确认删除？',
        trigger: () => (
          <NButton
            secondary
            type='error'
            size='small'
          >
            删除
          </NButton>
        ),
      }}
    </NPopconfirm>
  </div>
)
</script>

<template>
  <div class="flex flex-1 flex-col">
    <!-- scroll-x 取「所有列宽之和」：有固定列（操作列 fixed right）时，naive-ui 必须知道
         表格总宽度才会启用横向滚动，否则列被压扁换行而不是滚动。定义见 features/crawl/constants.ts -->
    <NDataTable
      v-model:checked-row-keys="checkedRowKeys"
      :remote="true"
      :flex-height="!isMaxLg"
      :columns="columns"
      :data="props.data"
      :row-key="rowKey"
      :loading="props.loading"
      :scroll-x="TABLE_SCROLL_X"
      class="flex-1"
    />
    <div class="mt-3 flex justify-end">
      <NPagination
        v-bind="props.pagination"
        :page-slot="isMaxMd ? 5 : undefined"
        :show-quick-jump-dropdown="!isMaxMd"
        :show-quick-jumper="!isMaxMd"
        :show-size-picker="!isMaxMd"
        :disabled="props.loading"
      />
    </div>
  </div>
</template>
