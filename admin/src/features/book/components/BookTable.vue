<script setup lang="tsx">
import {
  NAvatar,
  NButton,
  NDataTable,
  NEllipsis,
  NPagination,
  NPopconfirm,
  NTag,
} from 'naive-ui'
import { computed } from 'vue'

import { BOOK_ORIGIN_LABELS } from '@/api'
import { useComponentModifier, useInjection } from '@/composables'
import { ORIGIN_TAG_TYPE, TABLE_SCROLL_X } from '@/features/book/constants'
import { mediaQueryInjectionKey } from '@/injection'
import { formatDateTime } from '@/utils/format'

import type { AdminBook } from '@/api'
import type { DataTableColumns, PaginationProps } from 'naive-ui'

/**
 * 书籍列表表格（含分页器）。
 *
 * 拆出来的理由：这一块是纯展示 + 事件上抛，没有自己的状态——选中行、分页值都由父级持有。
 * 表格最容易出错的三处（固定列 + 横向滚动的宽度、checked-row-keys 的双向绑定、
 * 操作列的事件上抛）集中在这一个文件里，改动时只需要看这里。
 */
const props = defineProps<{
  data: AdminBook[]
  /** 列表或删除请求进行中：表格 loading + 分页器禁用 */
  loading: boolean
  pagination: PaginationProps
}>()

const emit = defineEmits<{
  edit: [book: AdminBook]
  chapters: [book: AdminBook]
  delete: [book: AdminBook]
}>()

/**
 * 选中行。用 defineModel 而不是 props + emit 手写：
 * NDataTable 的 checked-row-keys 是受控的，任一方向漏了都会出现「勾选后父级拿不到」。
 */
const checkedRowKeys = defineModel<Array<string | number>>('checkedRowKeys', { required: true })

const { isMaxMd, isMaxLg } = useInjection(mediaQueryInjectionKey)

const { getPopconfirmModifier } = useComponentModifier()

/** 提到外面而不是写在模板里：内联函数每次渲染都是新引用，会让表格判定 row-key 变化 */
const rowKey = (row: AdminBook) => row.id

const columns = computed<DataTableColumns<AdminBook>>(() => [
  {
    type: 'selection',
    options: ['all', 'none'],
  },
  {
    key: 'name',
    title: '书名',
    width: 260,
    render: (row) => (
      <div class='flex min-w-0 items-center gap-x-2'>
        <NAvatar
          src={row.coverUrl ?? undefined}
          size={32}
          object-fit='cover'
          class='shrink-0 rounded'
        >
          {row.name.slice(0, 1)}
        </NAvatar>
        <NEllipsis
          class='min-w-0 flex-1'
          tooltip
        >
          {row.name}
        </NEllipsis>
      </div>
    ),
  },
  {
    key: 'author',
    title: '作者',
    width: 130,
    render: (row) =>
      row.author ? <NEllipsis tooltip>{row.author}</NEllipsis> : <span class='opacity-40'>—</span>,
  },
  {
    key: 'sourceName',
    title: '书源',
    width: 130,
    render: (row) =>
      row.sourceName ? (
        <NEllipsis tooltip>{row.sourceName}</NEllipsis>
      ) : (
        <NTag bordered={false} size='small'>
          手动录入
        </NTag>
      ),
  },
  {
    key: 'chapterCount',
    title: '章节',
    width: 110,
    align: 'center',
    render: (row) => (
      <span>
        {row.chapterCount}
        {row.totalChapterNum != null && (
          <span class='opacity-40'> / {row.totalChapterNum}</span>
        )}
      </span>
    ),
  },
  {
    key: 'wordCount',
    title: '字数',
    width: 100,
    render: (row) =>
      row.wordCount ? <NEllipsis tooltip>{row.wordCount}</NEllipsis> : <span class='opacity-40'>—</span>,
  },
  {
    key: 'origin',
    title: '入库方式',
    width: 120,
    align: 'center',
    render: (row) => (
      <NTag bordered={false} size='small' type={ORIGIN_TAG_TYPE[row.origin]}>
        {BOOK_ORIGIN_LABELS[row.origin]}
      </NTag>
    ),
  },
  {
    key: 'authorName',
    title: '归属作家',
    width: 140,
    render: (row) =>
      row.authorName ? (
        <NEllipsis tooltip>{row.authorName}</NEllipsis>
      ) : (
        <NTag bordered={false} size='small'>
          无主
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
    width: 230,
    align: 'center',
    fixed: 'right',
    render: (row) => cellActions(row),
  },
])

/**
 * 操作列。
 *
 * 用普通函数而不是内联 JSX：三个按钮都要 emit，写在 columns 的 render 里会让 computed 每次求值
 * 都重建一遍整棵子树，肉眼看不出来但会拖慢大表格的重渲染。
 */
const cellActions = (row: AdminBook) => (
  <div class='flex justify-end gap-2'>
    <NButton
      secondary
      size='small'
      onClick={() => emit('chapters', row)}
    >
      章节
    </NButton>
    <NButton
      secondary
      type='primary'
      size='small'
      onClick={() => emit('edit', row)}
    >
      编辑
    </NButton>
    <NPopconfirm
      {...getPopconfirmModifier()}
      positiveText='确定'
      negativeText='取消'
      onPositiveClick={() => emit('delete', row)}
    >
      {{
        default: () => '删除后该书及其章节、正文都会消失，确认删除？',
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
         表格总宽度才会启用横向滚动，否则列被压扁换行而不是滚动。定义见 features/book/constants.ts -->
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
