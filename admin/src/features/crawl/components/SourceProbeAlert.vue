<script setup lang="ts">
import { NAlert } from 'naive-ui'
import { computed } from 'vue'

import type { SourceProbeResponse } from '@novel-plus/shared/dto'

/**
 * 站点探测结果的展示块。
 *
 * 抽成组件的原因：这个结论在**两个地方**出现——编辑抽屉里探单个地址、一键测试里探一整页。
 * 两处各写一份，迟早出现「单测说可访问、批量说失败」这种自相矛盾的提示。
 *
 * 这里只做展示，不做判断：探测本身由后端如实上报（ok / status / bodyBytes / title），
 * 颜色和补充说明是「怎么让人看懂」，属于界面职责。
 */
const props = defineProps<{
  result: SourceProbeResponse
  /** 探测时用的地址：用来判断是否发生了重定向 */
  url: string
}>()

/** 主提示：状态码 + 耗时 + 大小 + 标题，一行说清「打开得怎么样」 */
const summary = computed(() => {
  const result = props.result
  if (result.status === 0) return `无法访问：${result.error ?? '请求未到达'}`
  if (!result.ok) return `无法访问：站点返回 ${result.status}（${result.costMs}ms）`

  const size = `${(result.bodyBytes / 1024).toFixed(1)}KB`
  const parts = ['可访问', `${result.status}`, `${result.costMs}ms`, size]
  if (result.title) parts.push(`标题「${result.title}」`)
  return parts.join(' · ')
})

/**
 * 提示配色。
 *
 * 200 但内容极短判成 warning：这类响应多半是验证码页、限频提示页或需要 JS 渲染的壳子，
 * 说它「可访问」是对的，但直接给绿色会让管理员以为书源配好了能用。
 */
const alertType = computed<'success' | 'warning' | 'error'>(() => {
  const result = props.result
  if (!result.ok) return 'error'
  return result.bodyBytes < 1500 ? 'warning' : 'success'
})

/** 补充说明：重定向、Cookie 重试、疑似空壳、乱码，都是「可访问」之外值得知道的事 */
const notes = computed<string[]>(() => {
  const result = props.result
  const notes: string[] = []
  const currentUrl = props.url.trim()

  // 编码没有输入框了，靠这里让人看见「系统认定这站是什么编码」。
  // utf-8 不说（绝大多数站点都是，说了只是噪音），非默认值必须说，否则用户不知道系统怎么解的码
  if (result.charset && result.charset !== 'utf-8') {
    notes.push(`站点编码 ${result.charset}`)
  }
  if (result.finalUrl && result.finalUrl !== currentUrl) {
    notes.push(`跳转到 ${result.finalUrl}`)
  }
  if (result.cookieRetried) {
    notes.push('站点要求先带 Cookie，已自动重试成功')
  }
  if (result.ok && result.bodyBytes < 1500) {
    notes.push('响应内容过短，可能是验证码页、限频提示页，或需要 JS 渲染')
  }
  // 解码后出现替换字符（U+FFFD）= 编码猜错了，GBK 站点填成 utf-8 时典型表现
  if (result.title && result.title.includes('\uFFFD')) {
    notes.push('标题含乱码，检查「编码」是否与站点一致')
  }
  return notes
})
</script>

<template>
  <NAlert
    :type="alertType"
    :bordered="false"
    class="text-xs"
  >
    <div class="flex flex-col gap-y-1">
      <span>{{ summary }}</span>
      <span
        v-for="note in notes"
        :key="note"
        class="opacity-70"
      >
        · {{ note }}
      </span>
    </div>
  </NAlert>
</template>
