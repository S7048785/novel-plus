<script setup lang="ts" generic="T extends string | number">
import { NButton, NInput, NSelect } from 'naive-ui'

/**
 * 列表页通用查询条：一个关键字输入框 + 一个下拉筛选 + 查询/重置。
 *
 * 只负责「把输入值暴露出去」和「在点查询时通知父级」，不持有请求状态：
 * 值由父级（模块自己的 useXxxQuery）管，回车与点按钮走同一个 `query` 事件
 * （否则会出现「回车查一次、按钮查一次」两套逻辑）。
 *
 * 下拉的 model 名是通用的 `filter` 而不是 `origin` / `role`：各模块的筛选语义不同，
 * 用泛型 `T` 保留具体值域（书籍是 BOOK_ORIGINS，用户是 USER_ROLES），父级的类型不会被削成 string。
 *
 * 宽度用内联 px + shrink-0：naive-ui 的未分层样式会压掉工具类，只能靠 !important，
 * 内联样式是这里更省事的选择。
 */
const keyword = defineModel<string>('keyword', { required: true })

const filter = defineModel<T | null>('filter', { required: true })

withDefaults(
  defineProps<{
    /** 下拉选项，value 必须是 T（与 v-model:filter 的值域一致） */
    options: Array<{ label: string; value: T }>
    /** 关键字输入框的占位文案，如「书名或作者」「昵称或邮箱」 */
    placeholder: string
    /** 下拉的占位文案，如「全部来源」「全部身份」 */
    filterPlaceholder: string
    inputWidth?: number
    filterWidth?: number
    /** 查询按钮的 loading（只在拉列表时转，删除时用 disabled 挡住） */
    loading?: boolean
    /** 有任何请求在跑时禁用查询，避免并发覆盖结果 */
    disabled?: boolean
  }>(),
  {
    inputWidth: 300,
    filterWidth: 150,
    loading: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  query: []
  reset: []
}>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <NInput
      v-model:value="keyword"
      :placeholder="placeholder"
      clearable
      class="shrink-0"
      :style="{ width: `${inputWidth}px` }"
      @keyup.enter="emit('query')"
    />
    <NSelect
      v-model:value="filter"
      :options="options"
      :placeholder="filterPlaceholder"
      clearable
      class="shrink-0"
      :style="{ width: `${filterWidth}px` }"
    />
    <NButton
      type="info"
      :loading="loading"
      :disabled="disabled"
      @click="emit('query')"
    >
      <template #icon>
        <span class="iconify ph--magnifying-glass" />
      </template>
      查询
    </NButton>
    <NButton
      type="warning"
      @click="emit('reset')"
    >
      <template #icon>
        <span class="iconify ph--arrow-clockwise" />
      </template>
      重置
    </NButton>
  </div>
</template>
