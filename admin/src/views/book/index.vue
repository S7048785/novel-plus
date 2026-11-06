<script setup lang="ts">
import { NButton, NCard, NPopconfirm } from 'naive-ui'
import { computed, reactive } from 'vue'
import { useRouter } from 'vue-router'

import { ListQueryBar, ScrollContainer } from '@/components'
import { useComponentModifier, useInjection } from '@/composables'
import BookFormModal from '@/features/book/components/BookFormModal.vue'
import BookTable from '@/features/book/components/BookTable.vue'
import { useBookQuery } from '@/features/book/composables/useBookQuery'
import { useBookSelection } from '@/features/book/composables/useBookSelection'
import { ORIGIN_FILTER_OPTIONS } from '@/features/book/constants'
import { mediaQueryInjectionKey } from '@/injection'

import type { AdminBook } from '@/api'

/**
 * 书籍管理（`/api/admin/book`）。
 *
 * 只做「已入库书籍」的管理：采集入库走采集模块，这里负责查看、补元数据、删除。
 * 作家端上线后会有另一个只读自己名下书籍的页面，复用同一套接口但由后端按 viewer 缩小范围。
 *
 * 这个文件只做**编排**，不持有查询/选中/表格的实现：
 * - 查询条件与分页 → `useBookQuery`
 * - 行选中与删除 → `useBookSelection`
 * - 工具栏 → `BookQueryBar`，表格与分页器 → `BookTable`
 * 剩下的是「弹窗显隐」这种页面级状态，以及三个跳转/回调。
 */
defineOptions({
  name: 'BookList',
})

const { isMaxMd, isMaxLg } = useInjection(mediaQueryInjectionKey)

const router = useRouter()

const { getPopconfirmModifier } = useComponentModifier()

const {
  keywordInput,
  originFilter,
  pagination,
  isLoading,
  refetch,
  bookList,
  handleQuery,
  handleReset,
} = useBookQuery()

const { checkedRowKeys, hasSelection, loading: deleting, mutateDeleteBook, handleBatchDelete } =
  useBookSelection()

/** 列表请求与删除请求任意一个在跑，就禁用交互：避免并发覆盖结果 */
const mergedLoading = computed(() => isLoading.value || deleting.value)

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

function openForm(action: 'create' | 'update', book?: AdminBook) {
  formModal.action = action
  formModal.book = book
  formModal.show = true
}

/** 章节是书的子资源，路由自带 bookId（见 router/menu.ts 的 bookChapter） */
function openChapters(row: AdminBook) {
  router.push({ name: 'bookChapter', params: { bookId: row.id } })
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
      <!-- 工具条分两行：第一行查询条件、第二行操作按钮。
           之前挤在一行时，右侧按钮会把左侧条件挤到换行甚至互相覆盖 -->
      <div class="mb-2 flex flex-col gap-y-2 max-xl:mb-4">
        <ListQueryBar
          v-model:keyword="keywordInput"
          v-model:filter="originFilter"
          :options="ORIGIN_FILTER_OPTIONS"
          placeholder="书名或作者"
          filter-placeholder="全部来源"
          :loading="isLoading"
          :disabled="mergedLoading"
          @query="handleQuery"
          @reset="handleReset"
        />
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
                :disabled="!hasSelection || mergedLoading"
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

      <BookTable
        v-model:checked-row-keys="checkedRowKeys"
        :data="bookList"
        :loading="mergedLoading"
        :pagination="pagination"
        @edit="openForm('update', $event)"
        @chapters="openChapters"
        @delete="mutateDeleteBook($event.id)"
      />
    </NCard>

    <BookFormModal
      v-model:show="formModal.show"
      :action="formModal.action"
      :book="formModal.book"
      @success="handleFormSuccess"
    />
  </ScrollContainer>
</template>
