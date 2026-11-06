<script setup lang="ts">
import { NButton, NConfigProvider, NEmpty, NModal, NProgress, NScrollbar, NTag } from 'naive-ui'
import { onBeforeUnmount, watch } from 'vue'

import { useComponentThemeOverrides } from '@/composables'
import { useSourceProbe } from '@/features/crawl/composables/useSourceProbe'

import SourceProbeAlert from './SourceProbeAlert.vue'

import type { AdminBookSource } from '@/api'

/**
 * 一键测试：把当前页的书源逐个探一遍，看站点还活不活。
 *
 * 打开即开始，不再要求点第二次「开始」——按钮语义就是「一键」。
 * 每条的结果用 SourceProbeAlert 展示，与编辑抽屉里单条检测**同一份组件**，
 * 避免出现「单测说可访问、批量说失败」这种自相矛盾的提示。
 *
 * 检测的是**当前页**而非全库：探测要发真实外部请求，全库几百条会让管理员干等几分钟，
 * 而「我刚看到的这批站点是不是都挂了」才是日常问题。
 */
const props = defineProps<{
  show: boolean
  /** 要检测的书源（列表页传入当前页），打开时按这份快照开始 */
  sources: AdminBookSource[]
}>()

const emits = defineEmits<{
  'update:show': [value: boolean]
}>()

const { overlayThemeOverrides } = useComponentThemeOverrides()

const { items, running, total, finished, progress, stats, run, stop } = useSourceProbe()

watch(
  () => props.show,
  (show) => {
    if (show) {
      void run(props.sources)
    } else {
      // 关掉就不再排队打新请求；已发出的照常收尾
      stop()
    }
  },
  { immediate: true },
)

// 组件销毁（切路由）时也要停，否则后台还在持续打外部请求
onBeforeUnmount(stop)

function handleClose() {
  emits('update:show', false)
}
</script>

<template>
  <NConfigProvider :theme-overrides="overlayThemeOverrides">
    <NModal
      :show="show"
      preset="card"
      title="一键测试站点"
      class="w-[860px] max-w-[92vw]"
      :bordered="false"
      @update:show="handleClose"
    >
      <div class="flex flex-col gap-y-3">
        <div class="flex items-center gap-x-4">
          <NProgress
            type="line"
            :percentage="progress"
            :show-indicator="false"
            class="flex-1"
          />
          <span class="shrink-0 text-xs opacity-60">{{ finished }} / {{ total }}</span>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-xs">
          <NTag
            type="success"
            size="small"
            :bordered="false"
          >
            可访问 {{ stats.ok }}
          </NTag>
          <NTag
            type="error"
            size="small"
            :bordered="false"
          >
            站点失败 {{ stats.failed }}
          </NTag>
          <NTag
            v-if="stats.error > 0"
            size="small"
            :bordered="false"
          >
            请求异常 {{ stats.error }}
          </NTag>
          <span class="opacity-50">仅检测当前页的书源</span>
        </div>

        <NScrollbar
          v-if="items.length > 0"
          :style="{ maxHeight: '58vh' }"
        >
          <div class="flex flex-col gap-y-2 pr-1">
            <div
              v-for="item in items"
              :key="item.source.id"
              class="rounded-md border border-naive-border p-2"
            >
              <div class="mb-1 flex min-w-0 items-center gap-x-2">
                <span
                  class="truncate font-medium"
                  :title="item.source.sourceName"
                >
                  {{ item.source.sourceName }}
                </span>
                <span
                  class="truncate text-xs opacity-50"
                  :title="item.source.sourceUrl"
                >
                  {{ item.source.sourceUrl }}
                </span>
              </div>

              <SourceProbeAlert
                v-if="item.result"
                :result="item.result"
                :url="item.source.sourceUrl"
              />
              <div
                v-else-if="item.error"
                class="text-xs text-red-500"
              >
                {{ item.error }}
              </div>
              <div
                v-else
                class="text-xs opacity-50"
              >
                {{ item.status === 'running' ? '检测中…' : '等待中' }}
              </div>
            </div>
          </div>
        </NScrollbar>

        <NEmpty
          v-else
          description="当前页没有书源"
          class="py-8"
        />
      </div>

      <template #footer>
        <div class="flex justify-end gap-x-3">
          <NButton
            secondary
            :disabled="running || total === 0"
            @click="run(sources)"
          >
            重新测试
          </NButton>
          <NButton
            type="primary"
            @click="handleClose"
          >
            关闭
          </NButton>
        </div>
      </template>
    </NModal>
  </NConfigProvider>
</template>
