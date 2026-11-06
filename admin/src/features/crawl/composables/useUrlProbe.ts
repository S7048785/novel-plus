import { useMessage } from 'naive-ui'
import { ref, watch } from 'vue'

import { probeAdminBookSourceUrl } from '@/api'
import { textOrUndefined } from '@/features/crawl/source-config'
import { getErrorMessage } from '@/utils/error'

import type { SourceProbeResponse } from '@novel-plus/shared/dto'
import type { Ref } from 'vue'

/**
 * 单个站点地址的可达性探测（编辑抽屉里的「检测站点」按钮）。
 *
 * 与 `useSourceProbe` 的分工：那个是列表页的批量并发池（一次探一整页），
 * 这个是「一个地址、一个人点、要即时反馈」，两者状态模型不同，不要合并。
 *
 * 参数用 Ref 而不是值，是因为它会**写回 charset**——探测识别到的编码直接落到表单里，
 * 让这个副作用停留在函数签名上，而不是藏在调用方的某一行。
 */
export function useUrlProbe(params: {
  /** 站点地址输入框的值 */
  url: Ref<string>
  /** 站点编码：读它决定要不要显式传给后端，识别到新编码时写回 */
  charset: Ref<string>
  /** 详情里的原始地址；用来判断「用户是不是换了站点」 */
  originalUrl: () => string | undefined
}) {
  const message = useMessage()

  const probing = ref(false)
  const probeResult = ref<SourceProbeResponse | null>(null)

  /**
   * 地址一改就清掉上一次的结果，必要时把编码退回默认值。
   *
   * 清结果：改了域名还挂着「可访问 200」的绿色提示，等于给了个假结论——
   * 检测结果只对某一个地址负责。
   *
   * 退编码：编码没有输入框，只能靠探测自动识别；编辑态带进来的是「上一个站点」的结论
   * （比如详情里的 gbk）。换了站点还沿用它，探测会按错误编码解码、报出乱码标题，
   * 而用户此时又没有输入框可以纠正——所以只要地址偏离原值，就回到 utf-8 重新认。
   */
  watch(params.url, (next) => {
    probeResult.value = null

    const original = params.originalUrl()
    if (original !== undefined && next.trim() !== original) {
      params.charset.value = 'utf-8'
    }
  })

  async function probe() {
    const target = params.url.value.trim()
    if (!/^https?:\/\//i.test(target)) {
      message.warning('站点地址需以 http:// 或 https:// 开头')
      return
    }

    const currentCharset = textOrUndefined(params.charset.value)
    /**
     * 默认值 utf-8 不往后端传，让它按响应头 / meta 嗅探站点真实编码。
     *
     * 传了就成了「显式指定」，嗅探会被跳过——而那正是最需要识别的场景：
     * 用户没填编码、站点其实是 GBK。只有填了非默认值（说明他知道这站是什么编码）才传。
     */
    const shouldSendCharset =
      currentCharset !== undefined && currentCharset.toLowerCase() !== 'utf-8'

    probing.value = true
    probeResult.value = null
    try {
      const result = await probeAdminBookSourceUrl({
        url: target,
        charset: shouldSendCharset ? currentCharset : undefined,
      })
      probeResult.value = result

      // 识别到别的编码就悄悄记下：用户不用知道过程，只要保证采集时解对码。
      // 具体采用了什么编码，SourceProbeAlert 里会显示「站点编码 gbk」
      if (result.charset && result.charset !== (currentCharset ?? 'utf-8').toLowerCase()) {
        params.charset.value = result.charset
      }
    } catch (error) {
      // 走到这里是请求本身失败（400 地址不合法 / 403 无权限 / 网络断了），不是站点打不开
      message.error(getErrorMessage(error))
    } finally {
      probing.value = false
    }
  }

  return { probing, probeResult, probe }
}
