<script setup lang="tsx">
import { useMutation, useQuery } from '@pinia/colada'
import {
  NAvatar,
  NButton,
  NCard,
  NDataTable,
  NEllipsis,
  NInput,
  NPagination,
  NPopconfirm,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import { computed, reactive, ref, watch } from 'vue'

import { USER_ROLE_LABELS, deleteAdminUser, deleteAdminUsers, getAdminUsers } from '@/api'
import { ScrollContainer } from '@/components'
import { useComponentModifier, useInjection } from '@/composables'
import { mediaQueryInjectionKey } from '@/injection'
import { toRefsUserStore } from '@/stores/user'
import { getErrorMessage } from '@/utils/error'
import { formatDateTime } from '@/utils/format'

import UserFormModal from './UserFormModal.vue'

import type { AdminUser, UserRole } from '@/api'
import type { DataTableColumns, PaginationProps } from 'naive-ui'

defineOptions({
  name: 'UserList',
})

const { isMaxMd, isMaxLg } = useInjection(mediaQueryInjectionKey)

const { user: currentUser } = toRefsUserStore()

const message = useMessage()

const { getPopconfirmModifier } = useComponentModifier()

/** 输入框里的关键字与「已生效的关键字」分开：边打字边请求既浪费又会让列表闪烁 */
const keywordInput = ref('')
const keyword = ref('')

/** 身份筛选：null = 全部。选项文案见 roleFilterOptions 的注释 */
const roleFilter = ref<UserRole | null>(null)

const checkedRowKeys = ref<Array<string | number>>([])

/**
 * 弹窗状态放在页面里而不是交给 useModal()：
 * 显隐是「编辑哪一行」的一部分，和 action/user 强相关，放在一个 reactive 里能保证三者同步，
 * 也不会出现「弹窗关掉但状态还留在 provider 里」的情况。
 */
const formModal = reactive<{
  show: boolean
  action: 'create' | 'update'
  user?: AdminUser
}>({
  show: false,
  action: 'create',
  user: undefined,
})

const pagination = reactive<PaginationProps>({
  page: 1,
  pageSize: 10,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  itemCount: 0,
  showQuickJumper: true,
  // 页码/页大小写回 reactive 后，query key 变化会自动重新请求，不用手动 refetch
  onUpdatePage: (page) => {
    pagination.page = page
  },
  onUpdatePageSize: (pageSize) => {
    pagination.pageSize = pageSize
    pagination.page = 1
  },
})

const { data, isLoading, refetch } = useQuery({
  key: () => [
    'adminUsers',
    pagination.page ?? 1,
    pagination.pageSize ?? 10,
    keyword.value,
    roleFilter.value,
  ],
  query: () =>
    getAdminUsers({
      page: pagination.page ?? 1,
      pageSize: pagination.pageSize ?? 10,
      keyword: keyword.value,
      role: roleFilter.value ?? undefined,
    }),
  staleTime: 0,
})

const userList = computed<AdminUser[]>(() => data.value?.list ?? [])

// 总数同步给分页器（放在 watch 里而不是 computed 里：computed 不该有副作用，
// 那样每次重新求值都会改一次外部状态，容易来回触发渲染）
watch(data, (result) => {
  if (result) pagination.itemCount = result.total
})

const { isLoading: deleteLoading, mutate: mutateDeleteUser } = useMutation({
  mutation: deleteAdminUser,
  onSuccess: () => {
    message.success('已删除')
    refetch()
  },
  onError: (error) => message.error(getErrorMessage(error)),
})

const { isLoading: batchDeleteLoading, mutate: mutateDeleteUsers } = useMutation({
  mutation: deleteAdminUsers,
  onSuccess: (result) => {
    message.success(`已删除 ${result.deleted} 个用户`)
    checkedRowKeys.value = []
    refetch()
  },
  onError: (error) => message.error(getErrorMessage(error)),
})

const mergedLoading = computed(
  () => isLoading.value || deleteLoading.value || batchDeleteLoading.value,
)

/**
 * 身份筛选项的文案与后端语义对齐：
 * 作家/管理员是「持有该身份」，读者是「只有读者」（不含其他身份），
 * 所以这里直接写成「仅读者」，避免让人以为选它会筛出「所有读者」（那等于全部账号）。
 */
const roleFilterOptions = [
  { label: '仅读者', value: 'reader' },
  { label: '含作家', value: 'author' },
  { label: '含管理员', value: 'admin' },
]

const ROLE_TAG_TYPE: Record<UserRole, 'default' | 'info' | 'warning'> = {
  reader: 'default',
  author: 'info',
  admin: 'warning',
}

/** 自己那一行不能删也不能改身份（后端同样会拦，界面先拦住免得点了报错） */
const isSelf = (row: AdminUser) => row.id === currentUser.value?.id

const CellActions = (row: AdminUser) => (
  <div class='flex justify-end gap-2'>
    <NButton
      secondary
      type='primary'
      size='small'
      onClick={() => openForm('update', row)}
    >
      编辑
    </NButton>
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
        onPositiveClick={() => mutateDeleteUser(row.id)}
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
    render: (row) => (
      <div class='flex min-w-0 items-center gap-x-2'>
        <NAvatar
          src={row.image ?? undefined}
          round
          size={28}
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
    width: 160,
    align: 'center',
    fixed: 'right',
    render: (row) => CellActions(row),
  },
])

function openForm(action: 'create' | 'update', user?: AdminUser) {
  formModal.action = action
  formModal.user = user
  formModal.show = true
}

/** 弹窗里提交成功后：新增的用户排在第一页，已经在第一页只需刷新，否则改页码让它自动请求 */
function handleFormSuccess() {
  formModal.show = false

  if (formModal.action === 'create' && (pagination.page ?? 1) !== 1) {
    pagination.page = 1
  } else {
    refetch()
  }
}

/**
 * 查询：关键字与页码变化会通过 query key 自动触发请求；
 * 只有「条件没变」（重复点查询 / 已在该页）时才手动 refetch，
 * 否则会出现一次点击发两个请求的情况。
 */
function handleQuery() {
  const nextKeyword = keywordInput.value.trim()
  const unchanged = nextKeyword === keyword.value && (pagination.page ?? 1) === 1

  pagination.page = 1
  keyword.value = nextKeyword

  if (unchanged) refetch()
}

function handleReset() {
  const unchanged =
    keyword.value === '' && roleFilter.value === null && (pagination.page ?? 1) === 1

  keywordInput.value = ''
  keyword.value = ''
  roleFilter.value = null
  pagination.page = 1

  if (unchanged) refetch()
}

/** 切换身份筛选回到第一页：换了筛选条件后停在旧页码会看到空列表 */
function handleRoleFilterChange() {
  pagination.page = 1
}

function handleBatchDelete() {
  const ids = checkedRowKeys.value.map((key) => String(key))
  if (ids.length === 0) return
  mutateDeleteUsers(ids)
}
</script>
<template>
  <ScrollContainer
    wrapper-class="flex flex-col gap-y-2"
    :scrollable="isMaxLg"
  >
    <NCard
      :size="isMaxMd ? 'small' : undefined"
      class="flex-1"
      content-class="flex flex-col"
    >
      <!-- 与书籍页一致：第一行查询条件、第二行操作按钮，避免左右互相覆盖 -->
      <div class="mb-2 flex flex-col gap-y-2 max-xl:mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <NInput
            v-model:value="keywordInput"
            placeholder="昵称或邮箱"
            clearable
            size="medium"
            class="shrink-0"
            style="width: 320px"
            @keyup.enter="handleQuery"
          />
          <NSelect
            v-model:value="roleFilter"
            :options="roleFilterOptions"
            placeholder="全部身份"
            clearable
            size="medium"
            class="shrink-0"
            style="width: 150px"
            @update:value="handleRoleFilterChange"
          />
          <NButton
            type="info"
            size="medium"
            :loading="isLoading"
            :disabled="mergedLoading"
            @click="handleQuery"
          >
            <template #icon>
              <span class="iconify ph--magnifying-glass" />
            </template>
            查询
          </NButton>
          <NButton
            type="warning"
            size="medium"
            @click="handleReset"
          >
            <template #icon>
              <span class="iconify ph--arrow-clockwise" />
            </template>
            重置
          </NButton>
        </div>
        <div class="flex justify-end gap-2">
          <NPopconfirm
            v-bind="getPopconfirmModifier()"
            positive-text="确定"
            negative-text="取消"
            @positive-click="handleBatchDelete"
          >
            <template #trigger>
              <NButton
                type="error"
                secondary
                size="medium"
                :disabled="checkedRowKeys.length === 0 || mergedLoading"
              >
                <template #icon>
                  <span class="iconify ph--trash" />
                </template>
                删除所选（{{ checkedRowKeys.length }}）
              </NButton>
            </template>
            删除后这些账号无法登录，确认删除？
          </NPopconfirm>
          <NButton
            type="success"
            size="medium"
            @click="openForm('create')"
          >
            <template #icon>
              <span class="iconify ph--plus-circle" />
            </template>
            新增用户
          </NButton>
        </div>
      </div>

      <div class="flex flex-1 flex-col">
        <NDataTable
          v-model:checked-row-keys="checkedRowKeys"
          :remote="true"
          :flex-height="!isMaxLg"
          :columns="columns"
          :data="userList"
          :row-key="(row) => row.id"
          :loading="mergedLoading"
          :scroll-x="1400"
          class="flex-1"
        />
        <div class="mt-3 flex justify-end">
          <NPagination
            v-bind="pagination"
            :page-slot="isMaxMd ? 5 : undefined"
            :show-quick-jump-dropdown="!isMaxMd"
            :show-quick-jumper="!isMaxMd"
            :show-size-picker="!isMaxMd"
            :disabled="mergedLoading"
          />
        </div>
      </div>
    </NCard>

    <UserFormModal
      v-model:show="formModal.show"
      :action="formModal.action"
      :user="formModal.user"
      :can-edit-roles="formModal.action === 'create' || formModal.user?.id !== currentUser?.id"
      @success="handleFormSuccess"
    />
  </ScrollContainer>
</template>
