<script setup lang="ts">
import {
  NAlert,
  NButton,
  NConfigProvider,
  NEllipsis,
  NEmpty,
  NInput,
  NInputNumber,
  NModal,
  NScrollbar,
  NSpin,
  NStatistic,
  NTag,
  useMessage,
} from 'naive-ui'
import { computed, ref, watch } from 'vue'

import { testAdminBookSource } from '@/api'
import { useComponentThemeOverrides } from '@/composables'
import { getErrorMessage } from '@/utils/error'

import type { AdminBookSource } from '@/api'
import type { SourceTestResponse } from '@novel-plus/shared/dto'

/**
 * 测试书源：用关键词跑一次搜索，把命中结果和执行耗时摆出来。
 *
 * 这是配置书源时最常用的动作——规则写对没写对，跑一次就知道，不用先去采集整本书。
 * 后端把抓取/解析异常也包成 `ok: false` 的正常响应（不是 5xx），所以「站点挂了」「规则写错」
 * 都能在这里展示成一句人话，而不是一个红色的网络错误弹窗。
 */
const props = defineProps<{
  show: boolean
  source?: AdminBookSource
}>()

const emits = defineEmits<{
  'update:show': [value: boolean]
}>()

const message = useMessage()

const { overlayThemeOverrides } = useComponentThemeOverrides()

const keyword = ref('')
const page = ref<number | null>(1)

const testing = ref(false)
const result = ref<SourceTestResponse | null>(null)

/** 每次打开都清掉上一次的结果，避免把上一轮的书单误当成这一轮的 */
watch(
  () => props.show,
  (show) => {
    if (!show) return
    page.value = 1
    result.value = null
  },
  { immediate: true },
)

const canTest = computed(() => keyword.value.trim().length > 0 && !testing.value)

async function handleTest() {
  if (!props.source) return

  testing.value = true
  result.value = null
  try {
    result.value = await testAdminBookSource(
      props.source.id,
      keyword.value.trim(),
      page.value ?? 1,
    )
  } catch (error) {
    // 走到这里是「请求本身失败」（404 书源已删 / 403 无权限 / 网络断了），不是抓取失败
    message.error(getErrorMessage(error))
  } finally {
    testing.value = false
  }
}

function handleClose() {
  emits('update:show', false)
}
</script>

<template>
  <NConfigProvider :theme-overrides="overlayThemeOverrides">
    <NModal
      :show="show"
      preset="card"
      :title="`测试书源：${source?.sourceName ?? ''}`"
      class="w-[760px] max-w-[92vw]"
      :bordered="false"
      @update:show="handleClose"
    >
      <div class="flex flex-col gap-y-3">
        <div class="flex items-center gap-x-2">
          <NInput
            v-model:value="keyword"
            placeholder="搜索关键词"
            clearable
            class="flex-1"
            @keyup.enter="canTest && handleTest()"
          />
          <NInputNumber
            v-model:value="page"
            :min="1"
            :max="50"
            :precision="0"
            placeholder="页"
            class="w-24"
          />
          <NButton
            type="info"
            :loading="testing"
            :disabled="!canTest"
            @click="handleTest"
          >
            <template #icon>
              <span class="iconify ph--play" />
            </template>
            开始测试
          </NButton>
        </div>

        <NSpin :show="testing">
          <div class="min-h-32">
            <template v-if="result">
              <div class="mb-3 flex items-center gap-x-6">
                <NStatistic
                  label="状态"
                  class="!w-auto"
                >
                  <NTag
                    :type="result.ok ? 'success' : 'error'"
                    :bordered="false"
                    size="small"
                  >
                    {{ result.ok ? '规则可跑通' : '失败' }}
                  </NTag>
                </NStatistic>
                <NStatistic
                  label="耗时"
                  :value="result.costMs"
                  suffix="ms"
                  class="!w-auto"
                />
                <NStatistic
                  label="命中"
                  :value="result.total"
                  suffix="条"
                  class="!w-auto"
                />
              </div>

              <NAlert
                v-if="result.error"
                type="error"
                :bordered="false"
                class="mb-3"
              >
                {{ result.error }}
              </NAlert>

              <NAlert
                v-else-if="result.ok && result.total === 0"
                type="warning"
                :bordered="false"
                class="mb-3"
              >
                规则跑通了，但这个关键词没有命中——可能是站点本身没有这本书，换一个词再试。
              </NAlert>

              <NScrollbar
                v-if="result.list.length > 0"
                :style="{ maxHeight: '320px' }"
              >
                <div class="flex flex-col gap-y-2 pr-1">
                  <div
                    v-for="item in result.list"
                    :key="item.bookUrl"
                    class="rounded-md bg-black/5 p-2 text-sm dark:bg-white/5"
                  >
                    <div class="flex items-center gap-x-2">
                      <NEllipsis class="min-w-0 flex-1 font-medium">
                        {{ item.name }}
                      </NEllipsis>
                      <span class="shrink-0 text-xs opacity-60">{{ item.author || '—' }}</span>
                    </div>
                    <div class="mt-1 flex items-center gap-x-3 text-xs opacity-60">
                      <span
                        v-if="item.wordCount"
                        class="shrink-0"
                      >
                        {{ item.wordCount }}
                      </span>
                      <a
                        :href="item.bookUrl"
                        target="_blank"
                        rel="noreferrer noopener"
                        class="truncate underline decoration-dotted underline-offset-2"
                      >
                        {{ item.bookUrl }}
                      </a>
                    </div>
                  </div>
                </div>
              </NScrollbar>

              <NEmpty
                v-else
                description="没有解析出结果"
                class="py-6"
              />
            </template>

            <NEmpty
              v-else
              description="输入关键词后点「开始测试」"
              class="py-10"
            />
          </div>
        </NSpin>
      </div>
    </NModal>
  </NConfigProvider>
</template>
