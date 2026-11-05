<script setup lang="tsx">
import {
  NButton,
  NCard,
  NDataTable,
  NEllipsis,
  NPagination,
  NPopconfirm,
  NTag,
  useMessage,
} from 'naive-ui'
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ScrollContainer } from '@/components'
import { useComponentModifier, useInjection } from '@/composables'
import ChapterFormModal from '@/features/book/components/ChapterFormModal.vue'
import {
  useBookDetail,
  useChapterList,
  useDeleteChapter,
  useDeleteChapters,
} from '@/features/book/queries'
import { mediaQueryInjectionKey } from '@/injection'
import { getErrorMessage } from '@/utils/error'
import { formatDateTime } from '@/utils/format'

import type { AdminChapterQuery, AdminChapterSummary } from '@/api'
import type { DataTableColumns, PaginationProps } from 'naive-ui'

/**
 * 章节管理（`/api/admin/book/:bookId/chapter`）。
 *
 * 做成独立页面而不是书籍列表里的弹窗：目录动辄上千章，正文编辑也需要宽度，
 * 抽屉装不下。路由是 `book/:bookId/chapter`，只能从书籍列表带参进入，
 * 所以在菜单里标了 `show: false`（不出现在侧边栏，但路由要注册，否则手输 URL 是 404）。
 *
 * 列表接口只有分页、没有关键字搜索——界面上就不放假搜索框。
 */
defineOptions({
  name: 'BookChapter',
})

const route = useRoute()
const router = useRouter()

const message = useMessage()

const { isMaxMd, isMaxLg } = useInjection(mediaQueryInjectionKey)

const { getPopconfirmModifier } = useComponentModifier()

/** 路由参数（path 里是 string，接口要 number） */
const bookId = computed(() => Number(route.params.bookId))

/** 书名/归属等信息：列表头部要显示「在管哪本书」，避免进错书而不自知 */
const { data: book } = useBookDetail(() => bookId.value)

const checkedRowKeys = ref<Array<string | number>>([])

/** 抽屉状态：编辑态要带章节 id（正文由抽屉自己按 id 拉） */
const formModal = reactive<{
  show: boolean
  action: 'create' | 'update'
  chapterId?: number
}>({
  show: false,
  action: 'create',
  chapterId: undefined,
})

const pagination = reactive<PaginationProps>({
  page: 1,
  pageSize: 50,
  showSizePicker: true,
  pageSizes: [20, 50, 100, 200],
  itemCount: 0,
  showQuickJumper: true,
  onUpdatePage: (page) => {
    pagination.page = page
  },
  onUpdatePageSize: (pageSize) => {
    pagination.pageSize = pageSize
    pagination.page = 1
  },
})

const listQuery = computed<AdminChapterQuery>(() => ({
  page: pagination.page ?? 1,
  pageSize: pagination.pageSize ?? 50,
}))

const { data, isLoading, refetch } = useChapterList(
  () => bookId.value,
  () => listQuery.value,
)

const chapterList = computed<AdminChapterSummary[]>(() => data.value?.list ?? [])

watch(data, (result) => {
  if (result) pagination.itemCount = result.total
})

const { isLoading: deleteLoading, mutate: mutateDeleteChapter } = useDeleteChapter(
  () => bookId.value,
  {
    onSuccess: () => message.success('已删除'),
    onError: (error) => message.error(getErrorMessage(error)),
  },
)

const { isLoading: batchDeleteLoading, mutate: mutateDeleteChapters } = useDeleteChapters(
  () => bookId.value,
  {
    onSuccess: (result) => {
      message.success(`已删除 ${result.deleted} 章`)
      checkedRowKeys.value = []
    },
    onError: (error) => message.error(getErrorMessage(error)),
  },
)

const mergedLoading = computed(
  () => isLoading.value || deleteLoading.value || batchDeleteLoading.value,
)

const columns = computed<DataTableColumns<AdminChapterSummary>>(() => [
  {
    type: 'selection',
    options: ['all', 'none'],
  },
  {
    key: 'index',
    title: '序号',
    width: 80,
    align: 'center',
    render: (row) => row.index,
  },
  {
    key: 'title',
    title: '章节标题',
    width: 300,
    render: (row) => (
      <NEllipsis tooltip>
        <span
          class='cursor-pointer hover:underline'
          onClick={() => openForm('update', row.id)}
        >
          {row.title}
        </span>
      </NEllipsis>
    ),
  },
  {
    key: 'url',
    title: '源站地址',
    width: 220,
    render: (row) =>
      row.url ? (
        <NEllipsis
          class='opacity-60'
          tooltip
        >
          {row.url}
        </NEllipsis>
      ) : (
        <NTag bordered={false} size='small'>
          手动
        </NTag>
      ),
  },
  {
    key: 'contentLength',
    title: '正文字数',
    width: 110,
    align: 'center',
    render: (row) =>
      row.contentLength > 0 ? (
        row.contentLength
      ) : (
        <span class='opacity-40'>无正文</span>
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

const CellActions = (row: AdminChapterSummary) => (
  <div class='flex justify-end gap-2'>
    <NButton
      secondary
      type='primary'
      size='small'
      onClick={() => openForm('update', row.id)}
    >
      编辑
    </NButton>
    <NPopconfirm
      {...getPopconfirmModifier()}
      positiveText='确定'
      negativeText='取消'
      onPositiveClick={() => mutateDeleteChapter(row.id)}
    >
      {{
        default: () => '删除后该章正文一并消失，确认删除？',
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

function openForm(action: 'create' | 'update', chapterId?: number) {
  formModal.action = action
  formModal.chapterId = chapterId
  formModal.show = true
}

/** 新增的章节追加在末尾，留在当前页即可；页数变化由 total 驱动，不用强制跳页 */
function handleFormSuccess() {
  formModal.show = false
  refetch()
}

function handleBatchDelete() {
  const ids = checkedRowKeys.value.map((key) => Number(key))
  if (ids.length === 0) return
  mutateDeleteChapters(ids)
}

function backToBooks() {
  router.push({ name: 'bookList' })
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
          <NButton
            secondary
            @click="backToBooks"
          >
            <template #icon>
              <span class="iconify ph--arrow-left" />
            </template>
            返回书籍
          </NButton>
          <div class="flex min-w-0 flex-col">
            <span class="min-w-0 truncate text-base font-medium" :title="book?.name">{{ book?.name ?? '章节管理' }}</span>
            <span class="text-xs opacity-60">
              共 {{ pagination.itemCount }} 章
              <template v-if="book?.totalChapterNum != null">
                · 源站标称 {{ book.totalChapterNum }} 章
              </template>
            </span>
          </div>
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
            删除后这些章节的正文会一并消失，确认删除？
          </NPopconfirm>
          <NButton
            type="success"
            @click="openForm('create')"
          >
            <template #icon>
              <span class="iconify ph--plus-circle" />
            </template>
            新增章节
          </NButton>
        </div>
      </div>

      <div class="flex flex-1 flex-col">
        <NDataTable
          v-model:checked-row-keys="checkedRowKeys"
          :remote="true"
          :flex-height="!isMaxLg"
          :columns="columns"
          :data="chapterList"
          :row-key="(row) => row.id"
          :loading="mergedLoading"
          :scroll-x="1120"
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

    <ChapterFormModal
      v-model:show="formModal.show"
      :action="formModal.action"
      :book-id="bookId"
      :chapter-id="formModal.chapterId"
      @success="handleFormSuccess"
    />
  </ScrollContainer>
</template>
