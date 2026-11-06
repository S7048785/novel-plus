<script setup lang="tsx">
import {
  NAvatar,
  NButton,
  NDataTable,
  NPagination,
  NPopconfirm,
  NTag,
} from 'naive-ui'
import { computed } from 'vue'

import { USER_ROLE_LABELS } from '@/api'
import { useComponentModifier, useInjection } from '@/composables'
import { ROLE_TAG_TYPE, TABLE_SCROLL_X } from '@/features/user/constants'
import { mediaQueryInjectionKey } from '@/injection'
import { formatDateTime } from '@/utils/format'

import type { AdminUser } from '@/api'
import type { DataTableColumns, PaginationProps } from 'naive-ui'

/**
 * 用户列表表格（含分页器）。
 *
 * 与书籍表格同构：无状态，选中行与分页值都由父级持有，操作列只往外抛事件。
 *
 * 唯一多出来的东西是 `selfId`：当前登录账号自己那一行不能删——后端也会拦，
 * 但让按钮可点再报错是纯浪费。身份列还要给它加一个「我」标签。
 * 用 prop 传而不是在组件里读 store：表格因此不依赖登录态，测试可以直接给一个 id。
 */
const props = defineProps<{
  data: AdminUser[]
  /** 列表或删除请求进行中：表格 loading + 分页器禁用 */
  loading: boolean
  pagination: PaginationProps
  /** 当前登录账号 id；用来禁用「删除自己」并标出「我」 */
  selfId?: string
}>()

const emit = defineEmits<{
  edit: [user: AdminUser]
  delete: [user: AdminUser]
}>()

const checkedRowKeys = defineModel<Array<string | number>>('checkedRowKeys', { required: true })

const { isMaxMd, isMaxLg } = useInjection(mediaQueryInjectionKey)

const { getPopconfirmModifier } = useComponentModifier()

/** 提到外面而不是写在模板里：内联函数每次渲染都是新引用，会让表格判定 row-key 变化 */
const rowKey = (row: AdminUser) => row.id

const isSelf = (row: AdminUser) => row.id === props.selfId

/**
 * 操作列只有「删除」：编辑入口移到了首列（点昵称）。
 *
 * 自己那一行不能删：后端也会拦，但让按钮可点再报错是纯浪费，
 * 所以直接禁用而不是点了再吃 400。
 */
const cellActions = (row: AdminUser) => (
  <div class='flex justify-end'>
    {isSelf(row) ? (
      <NButton
        secondary
        type='error'
        size='small'
        disabled
      >
        删除
      </NButton>
    ) : (
      <NPopconfirm
        {...getPopconfirmModifier()}
        positiveText='确定'
        negativeText='取消'
        onPositiveClick={() => emit('delete', row)}
      >
        {{
          default: () => '删除后该账号无法登录，确认删除？',
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
    )}
  </div>
)

const columns = computed<DataTableColumns<AdminUser>>(() => [
  {
    type: 'selection',
    options: ['all', 'none'],
  },
  {
    key: 'name',
    title: '昵称',
    width: 220,
    /**
     * 首列就是编辑入口：点昵称直接打开编辑抽屉（与书籍、书源表格保持一致）。
     *
     * 不用 NButton text：它内部是 inline-flex 容器，嵌进固定宽度单元格后 truncate 不生效，
     * 长昵称会撑破列。span + min-w-0 flex-1 直接吃剩余宽度，配合 title 给原生 tooltip。
     */
    render: (row) => (
      <div class='flex min-w-0 items-center gap-x-2'>
        <NAvatar
          src={row.image ?? undefined}
          round
          size={28}
        >
          {row.name.slice(0, 1)}
        </NAvatar>
        <span
          class='min-w-0 flex-1 cursor-pointer truncate transition-[color] hover:text-primary hover:underline'
          title={row.name}
          onClick={() => emit('edit', row)}
        >
          {row.name}
        </span>
      </div>
    ),
  },
  {
    key: 'email',
    title: '邮箱',
    width: 240,
    ellipsis: { tooltip: true },
  },
  {
    key: 'roles',
    title: '身份',
    width: 200,
    render: (row) => (
      <div class='flex flex-wrap gap-1'>
        {row.roles.map((role) => (
          <NTag
            bordered={false}
            size='small'
            type={ROLE_TAG_TYPE[role]}
          >
            {USER_ROLE_LABELS[role]}
          </NTag>
        ))}
        {isSelf(row) && (
          <NTag
            bordered={false}
            size='small'
            type='success'
          >
            我
          </NTag>
        )}
      </div>
    ),
  },
  {
    key: 'emailVerified',
    title: '邮箱验证',
    width: 110,
    align: 'center',
    render: (row) => (
      <NTag
        bordered={false}
        size='small'
        type={row.emailVerified ? 'success' : 'default'}
      >
        {row.emailVerified ? '已验证' : '未验证'}
      </NTag>
    ),
  },
  {
    key: 'createdAt',
    title: '注册时间',
    width: 190,
    render: (row) => formatDateTime(row.createdAt),
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
    width: 100,
    align: 'center',
    fixed: 'right',
    render: (row) => cellActions(row),
  },
])
</script>

<template>
  <div class="flex flex-1 flex-col">
    <!-- scroll-x 取列宽之和，否则有固定列时不启用横向滚动，见 features/user/constants.ts -->
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
