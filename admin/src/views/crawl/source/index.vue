<script setup lang="ts">
import { NButton, NCard, NPopconfirm } from 'naive-ui'
import { computed, reactive } from 'vue'

import { ListQueryBar, ScrollContainer } from '@/components'
import { useComponentModifier, useInjection } from '@/composables'
import SourceFormModal from '@/features/crawl/components/SourceFormModal.vue'
import SourceProbeModal from '@/features/crawl/components/SourceProbeModal.vue'
import SourceTable from '@/features/crawl/components/SourceTable.vue'
import SourceTestModal from '@/features/crawl/components/SourceTestModal.vue'
import { useSourceQuery } from '@/features/crawl/composables/useSourceQuery'
import { useSourceSelection } from '@/features/crawl/composables/useSourceSelection'
import { SOURCE_ENABLED_FILTER_OPTIONS } from '@/features/crawl/constants'
import { mediaQueryInjectionKey } from '@/injection'

import type { AdminBookSource } from '@/api'

/**
 * 书源管理（`/api/admin/crawl/source`）。
 *
 * 书源是**采集配置**，不是采到的内容：改一条会影响所有依赖它的书的采集结果，
 * 所以整个模块只有管理员能进（后端 controller 上有 @Roles('admin')，这里只是界面收口）。
 *
 * 这个文件只做**编排**，不持有查询/选中/表格的实现：
 * - 查询条件与分页 → `useSourceQuery`
 * - 行选中、删除、行内启用开关 → `useSourceSelection`
 * - 表格与分页器 → `SourceTable`，两个抽屉 → `SourceFormModal` / `SourceTestModal`
 * 剩下的是「抽屉显隐」这种页面级状态，以及两个回调。
 */
defineOptions({
  name: 'CrawlSource',
})

const { isMaxMd, isMaxLg } = useInjection(mediaQueryInjectionKey)

const { getPopconfirmModifier } = useComponentModifier()

const {
  keywordInput,
  enabledFilter,
  pagination,
  isLoading,
  refetch,
  sourceList,
  handleQuery,
  handleReset,
} = useSourceQuery()

const {
  checkedRowKeys,
  hasSelection,
  loading: mutating,
  mutateDeleteSource,
  handleBatchDelete,
  handleToggleEnabled,
} = useSourceSelection()

/** 列表请求与写请求任意一个在跑，就禁用交互：避免并发覆盖结果 */
const mergedLoading = computed(() => isLoading.value || mutating.value)

/** 新增 / 编辑抽屉：显隐与「编辑哪个书源」放一起，避免两者不同步 */
const formModal = reactive<{
  show: boolean
  action: 'create' | 'update'
  sourceId?: number
}>({
  show: false,
  action: 'create',
  sourceId: undefined,
})

function openForm(action: 'create' | 'update', source?: AdminBookSource) {
  formModal.action = action
  formModal.sourceId = source?.id
  formModal.show = true
}

/** 测试抽屉：只传 id 与名称用来显示标题 */
const testModal = reactive<{
  show: boolean
  source?: AdminBookSource
}>({
  show: false,
  source: undefined,
})

function openTest(source: AdminBookSource) {
  testModal.source = source
  testModal.show = true
}

/**
 * 一键测试：检测**当前页**书源的站点可达性。
 *
 * 传入的是当前页数据，弹窗打开那一刻的这份就是它的工作集——
 * 之后再去翻页/筛选，不会打断正在跑的检测（也不会把新一页混进来）。
 */
const probeModal = reactive({ show: false })

/**
 * 保存成功后的收尾。
 *
 * 缓存失效由 mutation 负责（列表与详情都会过期），这里只需要处理分页：
 * 新增的书源按 id 倒序排在最前，所以回第一页；编辑后原地刷新即可。
 */
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
      <!-- 工具条分两行：第一行查询条件、第二行操作按钮（同书籍管理页） -->
      <div class="mb-2 flex flex-col gap-y-2 max-xl:mb-4">
        <ListQueryBar
          v-model:keyword="keywordInput"
          v-model:filter="enabledFilter"
          :options="SOURCE_ENABLED_FILTER_OPTIONS"
          placeholder="书源名称或站点地址"
          filter-placeholder="全部状态"
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
            删除书源不会删除已采集的书籍，确认删除？
          </NPopconfirm>
          <NButton
            type="info"
            secondary
            :disabled="sourceList.length === 0"
            @click="probeModal.show = true"
          >
            <template #icon>
              <span class="iconify ph--pulse" />
            </template>
            一键测试
          </NButton>
          <NButton
            type="success"
            @click="openForm('create')"
          >
            <template #icon>
              <span class="iconify ph--plus-circle" />
            </template>
            新增书源
          </NButton>
        </div>
      </div>

      <SourceTable
        v-model:checked-row-keys="checkedRowKeys"
        :data="sourceList"
        :loading="mergedLoading"
        :pagination="pagination"
        @edit="openForm('update', $event)"
        @test="openTest"
        @delete="mutateDeleteSource($event.id)"
        @toggle="(source, value) => handleToggleEnabled(source.id, value)"
      />
    </NCard>

    <SourceFormModal
      v-model:show="formModal.show"
      :action="formModal.action"
      :source-id="formModal.sourceId"
      @success="handleFormSuccess"
    />

    <SourceTestModal
      v-model:show="testModal.show"
      :source="testModal.source"
    />

    <SourceProbeModal
      v-model:show="probeModal.show"
      :sources="sourceList"
    />
  </ScrollContainer>
</template>
