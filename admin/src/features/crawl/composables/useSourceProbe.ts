import { computed, ref } from 'vue'

import { probeAdminBookSourceUrl } from '@/api'
import { getErrorMessage } from '@/utils/error'

import type { AdminBookSource } from '@/api'
import type { SourceProbeResponse } from '@novel-plus/shared/dto'

/** 单条书源的探测进度 */
export interface ProbeItem {
  source: AdminBookSource
  status: 'pending' | 'running' | 'done'
  result?: SourceProbeResponse
  /** 请求本身失败（后端 4xx/网络断了），与「站点打不开」不是一回事 */
  error?: string
}

/**
 * 一键测试的并发探测。
 *
 * 为什么在前端排队而不是加批量接口：
 * - 每完成一条就能立刻上色，管理员不用盯着一整屏空白等 20 秒；
 * - 关掉弹窗能立刻停止排新的请求（已发出的收不回来，但不用再打后 10 个）。
 *
 * 并发数限制在 4：探测是「一次外部 HTTP 请求」，20 条一起打出去既容易被站点风控，
 * 也会让本地连接池排队，反而不比 4 个快多少。
 */
const DEFAULT_CONCURRENCY = 4

export function useSourceProbe(concurrency = DEFAULT_CONCURRENCY) {
  const items = ref<ProbeItem[]>([])
  const running = ref(false)

  /** 关闭弹窗时置 true：worker 不再领取新任务（循环条件里检查） */
  let cancelled = false

  const total = computed(() => items.value.length)

  const finished = computed(() => items.value.filter((item) => item.status === 'done').length)

  const progress = computed(() =>
    total.value === 0 ? 0 : Math.round((finished.value / total.value) * 100),
  )

  /** 汇总：可访问 / 站点返回失败 / 请求本身出错，三类分开数，便于一眼看结论 */
  const stats = computed(() => {
    const done = items.value.filter((item) => item.status === 'done')
    return {
      ok: done.filter((item) => item.result?.ok === true).length,
      failed: done.filter((item) => item.result !== undefined && !item.result.ok).length,
      error: done.filter((item) => item.result === undefined).length,
    }
  })

  async function run(sources: AdminBookSource[]) {
    // 重新开始：上一轮结果直接丢掉（保留会让两批数据混在一起，无法判断哪个是新的）
    items.value = sources.map((source) => ({ source, status: 'pending' }))
    if (items.value.length === 0) return

    running.value = true
    cancelled = false

    let cursor = 0

    /**
     * 取任务与推进游标是同步完成的（中间没有 await），所以多个 worker 不会拿到同一个下标。
     * 这一点是并发池正确的关键，别在 `const index = cursor` 和 `cursor += 1` 之间插异步。
     */
    const worker = async () => {
      while (!cancelled) {
        const index = cursor
        cursor += 1
        if (index >= items.value.length) return

        const item = items.value[index]
        if (!item) return

        item.status = 'running'
        try {
          // 不传 charset：列表接口不带 json 配置，后端会从响应头/meta 自动嗅探
          item.result = await probeAdminBookSourceUrl({ url: item.source.sourceUrl })
        } catch (error) {
          item.error = getErrorMessage(error)
        } finally {
          item.status = 'done'
        }
      }
    }

    const workerCount = Math.min(concurrency, items.value.length)
    await Promise.all(Array.from({ length: workerCount }, worker))

    running.value = false
  }

  /**
   * 停止领取新任务；已在飞行的请求照常收尾，结果不会丢。
   *
   * 故意不在这里挂 onBeforeUnmount：那会让 composable 依赖组件实例（在测试里直接调用
   * 会报 "no active component instance"），卸载时的清理交给使用方（弹窗）负责。
   */
  function stop() {
    cancelled = true
  }

  return { items, running, total, finished, progress, stats, run, stop }
}
