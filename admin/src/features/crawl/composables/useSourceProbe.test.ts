import { describe, expect, it, vi } from 'vitest'

import { probeAdminBookSourceUrl } from '@/api'

import { useSourceProbe } from './useSourceProbe'

import type { AdminBookSource } from '@/api'
import type { SourceProbeResponse } from '@novel-plus/shared/dto'

vi.mock('@/api', () => ({
  probeAdminBookSourceUrl: vi.fn(),
}))

// vi.mock 会被提升到 import 之前，所以这里拿到的是被替换后的函数
const probeMock = vi.mocked(probeAdminBookSourceUrl)

/**
 * 一键测试的并发池行为。
 *
 * 值得测的两点，都是「肉眼点页面看不出来」的：
 * 1. 并发上限真的是 4（没限住就会几十个请求同时打外部站点，容易被风控）；
 * 2. stop() 之后不再领新任务，但已经在飞的那几条结果不能丢。
 */
function makeSources(count: number): AdminBookSource[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    sourceName: `源${index + 1}`,
    sourceUrl: `https://site${index + 1}.example.com`,
    enabled: true,
    status: 0,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  }))
}

function okResult(): SourceProbeResponse {
  return {
    ok: true,
    status: 200,
    costMs: 12,
    finalUrl: 'https://example.com/',
    bodyBytes: 40960,
    charset: 'utf-8',
    title: '示例',
  }
}

/** 让出一个宏任务，模拟真实网络往返（也给并发计数器留出观察点） */
const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

describe('useSourceProbe', () => {
  it('全部跑完后每条都是 done，统计按结果分类', async () => {
    probeMock.mockReset()
    probeMock
      .mockResolvedValueOnce(okResult())
      .mockRejectedValueOnce(new Error('网络断了'))
      .mockResolvedValue({ ...okResult(), ok: false, status: 503 })

    const probe = useSourceProbe(4)
    await probe.run(makeSources(3))

    expect(probe.items.value).toHaveLength(3)
    expect(probe.items.value.every((item) => item.status === 'done')).toBe(true)
    expect(probe.running.value).toBe(false)
    expect(probe.finished.value).toBe(3)
    expect(probe.progress.value).toBe(100)

    // 一条可访问、一条请求异常（抛错）、一条站点返回 503
    expect(probe.stats.value).toEqual({ ok: 1, failed: 1, error: 1 })
  })

  it('并发不超过上限', async () => {
    probeMock.mockReset()

    let active = 0
    let peak = 0
    probeMock.mockImplementation(async () => {
      active += 1
      peak = Math.max(peak, active)
      await tick()
      active -= 1
      return okResult()
    })

    const probe = useSourceProbe(4)
    await probe.run(makeSources(12))

    expect(probe.finished.value).toBe(12)
    expect(peak).toBeLessThanOrEqual(4)
    // 也要确认它真的并发跑了，而不是一个接一个（那样 4 个并发上限形同虚设）
    expect(peak).toBeGreaterThan(1)
  })

  it('stop() 之后不再领新任务，已在飞的结果仍然记下', async () => {
    probeMock.mockReset()
    probeMock.mockImplementation(async () => {
      await tick()
      return okResult()
    })

    const probe = useSourceProbe(2)
    const pending = probe.run(makeSources(10))
    // 此时 2 个 worker 已各领一条在飞，其余排队
    probe.stop()
    await pending

    expect(probe.finished.value).toBeLessThan(10)
    expect(probe.finished.value).toBeGreaterThanOrEqual(1)
    expect(probe.running.value).toBe(false)
  })

  it('重新开始会丢掉上一轮结果', async () => {
    probeMock.mockReset()
    probeMock.mockResolvedValue(okResult())

    const probe = useSourceProbe(4)
    await probe.run(makeSources(3))
    expect(probe.total.value).toBe(3)

    await probe.run(makeSources(5))
    expect(probe.total.value).toBe(5)
    expect(probe.items.value.every((item) => item.result !== undefined)).toBe(true)
  })
})
