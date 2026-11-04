<script setup lang="tsx">
import { useMutation, useQuery } from '@pinia/colada'
import {
  NAvatar,
  NButton,
  NCard,
  NDataTable,
  NInput,
  NPagination,
  NPopconfirm,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import { computed, reactive, ref, watch } from 'vue'

import { BOOK_ORIGIN_LABELS, deleteAdminBook, deleteAdminBooks, getAdminBooks, getAdminUsers } from '@/api'
import { ScrollContainer } from '@/components'
import { useComponentModifier, useInjection } from '@/composables'
import { mediaQueryInjectionKey } from '@/injection'
import { getErrorMessage } from '@/utils/error'
import { formatDateTime } from '@/utils/format'

import BookFormModal from './BookFormModal.vue'

import type { AdminBook, BookOrigin } from '@/api'
import type { DataTableColumns, PaginationProps } from 'naive-ui'

/**
 * 书籍管理（`/api/admin/book`）。
 *
 * 只做「已入库书籍」的管理：采集入库走采集模块，这里负责查看、补元数据、删除。
 * 作家端上线后会有另一个只读自己名下书籍的页面，复用同一套接口但由后端按 viewer 缩小范围。
 */
defineOptions({
  name: 'BookList',
})

const { isMaxMd, isMaxLg } = useInjection(mediaQueryInjectionKey)

const message = useMessage()

const { getPopconfirmModifier } = useComponentModifier()

/** 输入框里的关键字与「已生效的关键字」分开：边打字边请求既浪费又会让列表闪烁 */
const keywordInput = ref('')
const keyword = ref('')

/** 入库方式筛选：null = 全部 */
const originFilter = ref<BookOrigin | null>(null)

const originFilterOptions = (Object.keys(BOOK_ORIGIN_LABELS) as BookOrigin[]).map((origin) => ({
  label: BOOK_ORIGIN_LABELS[origin],
  value: origin,
}))

/** 三种入库方式的标签配色：采集偏中性、作家上传提示色、手动导入信息色 */
const ORIGIN_TAG_TYPE: Record<BookOrigin, 'default' | 'info' | 'success'> = {
  crawl: 'default',
  manual: 'info',
  author: 'success',
}

/** 归属作家筛选：'' = 全部（NSelect 的 clearable 会把值置 null，这里统一用空串语义） */
const authorFilter = ref<string | null>(null)

/**
 * 作家候选列表：只有持有 author 身份的账号才能被指派为书籍归属（后端也会校验）。
 *
 * pageSize 取后端上限 100——作家数量级远小于它，一次拉完比做远程搜索简单得多。
 * 真到几百个作家时再改成 NSelect 的远程过滤（remote + filterable）。
 */
const { data: authorData } = useQuery({
  key: () => ['authorCandidates'],
  query: () => getAdminUsers({ page: 1, pageSize: 100, role: 'author' }),
  staleTime: 60_000,
})

const authorOptions = computed(() =>
  (authorData.value?.list ?? []).map((user) => ({
    label: user.name,
    value: user.id,
  })),
)

const checkedRowKeys = ref<Array<string | number>>([])

/** 弹窗状态：显隐与「编辑哪本书」放一起，避免两者不同步 */
const formModal = reactive<{
  show: boolean
  action: 'create' | 'update'
  book?: AdminBook
}>({
  show: false,
  action: 'create',
  book: undefined,
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
    'adminBooks',
    pagination.page ?? 1,
    pagination.pageSize ?? 10,
    keyword.value,
    originFilter.value,
    authorFilter.value,
  ],
  query: () =>
    getAdminBooks({
      page: pagination.page ?? 1,
      pageSize: pagination.pageSize ?? 10,
      keyword: keyword.value,
      origin: originFilter.value ?? undefined,
      authorId: authorFilter.value ?? undefined,
    }),
  staleTime: 0,
})

const bookList = computed<AdminBook[]>(() => data.value?.list ?? [])

// 总数同步给分页器（放 watch 而不是 computed：computed 里改外部状态会来回触发渲染）
watch(data, (result) => {
  if (result) pagination.itemCount = result.total
})

const { isLoading: deleteLoading, mutate: mutateDeleteBook } = useMutation({
  mutation: deleteAdminBook,
  onSuccess: () => {
    message.success('已删除')
    refetch()
  },
  onError: (error) => message.error(getErrorMessage(error)),
})

const { isLoading: batchDeleteLoading, mutate: mutateDeleteBooks } = useMutation({
  mutation: deleteAdminBooks,
  onSuccess: (result) => {
    message.success(`已删除 ${result.deleted} 本书`)
    checkedRowKeys.value = []
    refetch()
  },
  onError: (error) => message.error(getErrorMessage(error)),
})

const mergedLoading = computed(
  () => isLoading.value || deleteLoading.value || batchDeleteLoading.value,
)

const columns = computed<DataTableColumns<AdminBook>>(() => [
  {
    type: 'selection',
    options: ['all', 'none'],
  },
  {
    key: 'name',
    title: '书名',
    minWidth: 240,
    render: (row) => (
      <div class='flex items-center gap-x-2'>
        <NAvatar
          src={row.coverUrl ?? undefined}
          size={32}
          object-fit='cover'
          class='shrink-0 rounded'
        >
          {row.name.slice(0, 1)}
        </NAvatar>
        <span class='truncate'>{row.name}</span>
      </div>
    ),
  },
  {
    key: 'author',
    title: '作者',
    width: 130,
    render: (row) => row.author ?? <span class='opacity-40'>—</span>,
  },
  {
    key: 'sourceName',
    title: '书源',
    width: 130,
    render: (row) =>
      row.sourceName ?? <NTag bordered={false} size='small'>手动录入</NTag>,
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
    render: (row) => row.wordCount ?? <span class='opacity-40'>—</span>,
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
      row.authorName ?? (
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
    width: 160,
    align: 'center',
    fixed: 'right',
    render: (row) => CellActions(row),
  },
])

const CellActions = (row: AdminBook) => (
  <div class='flex justify-end gap-2'>
    <NButton
      secondary
      type='primary'
      size='small'
      onClick={() => openForm('update', row)}
    >
      编辑
    </NButton>
    <NPopconfirm
      {...getPopconfirmModifier()}
      positiveText='确定'
      negativeText='取消'
      onPositiveClick={() => mutateDeleteBook(row.id)}
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

function openForm(action: 'create' | 'update', book?: AdminBook) {
  formModal.action = action
  formModal.book = book
  formModal.show = true
}

/** 新增的书按更新时间倒序排在前面，所以回到第一页；编辑后原地刷新即可 */
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
 * 只有「条件没变」（重复点查询 / 已在该页）时才手动 refetch，避免一次点击发两个请求。
 */
function handleQuery() {
  const nextKeyword = keywordInput.value.trim()
  const unchanged =
    nextKeyword === keyword.value && authorFilter.value === null && (pagination.page ?? 1) === 1

  pagination.page = 1
  keyword.value = nextKeyword

  if (unchanged) refetch()
}

function handleReset() {
  const unchanged =
    keyword.value === '' &&
    originFilter.value === null &&
    authorFilter.value === null &&
    (pagination.page ?? 1) === 1

  keywordInput.value = ''
  keyword.value = ''
  originFilter.value = null
  authorFilter.value = null
  pagination.page = 1

  if (unchanged) refetch()
}

/** 切换筛选回到第一页：换了条件还停在旧页码会看到空列表 */
function handleFilterChange() {
  pagination.page = 1
}

function handleBatchDelete() {
  const ids = checkedRowKeys.value.map((key) => Number(key))
  if (ids.length === 0) return
  mutateDeleteBooks(ids)
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
      <div class="mb-2 flex justify-between gap-x-4 max-xl:mb-4 max-xl:flex-wrap">
        <div class="flex flex-wrap items-center gap-2">
          <NInput
            v-model:value="keywordInput"
            placeholder="书名或作者"
            clearable
            class="w-56"
            @keyup.enter="handleQuery"
          />
          <NSelect
            v-model:value="originFilter"
            :options="originFilterOptions"
            placeholder="全部来源"
            clearable
            class="w-36"
            @update:value="handleFilterChange"
          />
          <NSelect
            v-model:value="authorFilter"
            :options="authorOptions"
            placeholder="全部作家"
            clearable
            filterable
            class="w-44"
            @update:value="handleFilterChange"
          />
          <NButton
            type="info"
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
            @click="handleReset"
          >
            <template #icon>
              <span class="iconify ph--arrow-clockwise" />
            </template>
            重置
          </NButton>
        </div>
        <div class="flex gap-2">
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
                :disabled="checkedRowKeys.length === 0 || mergedLoading"
              >
                <template #icon>
                  <span class="iconify ph--trash" />
                </template>
                删除所选（{{ checkedRowKeys.length }}）
              </NButton>
            </template>
            删除后这些书及其章节、正文都会消失，确认删除？
          </NPopconfirm>
          <NButton
            type="success"
            @click="openForm('create')"
          >
            <template #icon>
              <span class="iconify ph--plus-circle" />
            </template>
            新增书籍
          </NButton>
        </div>
      </div>

      <div class="flex flex-1 flex-col">
        <!-- scroll-x 取「所有列宽之和」：有固定列（操作列 fixed right）时，naive-ui 必须知道
             表格总宽度才会启用横向滚动，否则列被压扁换行而不是滚动 -->
        <NDataTable
          v-model:checked-row-keys="checkedRowKeys"
          :remote="true"
          :flex-height="!isMaxLg"
          :columns="columns"
          :data="bookList"
          :row-key="(row) => row.id"
          :loading="mergedLoading"
          :single-line="false"
          :scroll-x="1420"
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

    <BookFormModal
      v-model:show="formModal.show"
      :action="formModal.action"
      :book="formModal.book"
      :author-options="authorOptions"
      @success="handleFormSuccess"
    />
  </ScrollContainer>
</template>
