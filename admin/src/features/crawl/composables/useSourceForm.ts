import { computed, ref } from 'vue'

import { buildSourcePayload, checkConfigJson, extractConfig } from '@/features/crawl/source-config'

import type { BookSourceDetail, BookSourceInput } from '@novel-plus/shared/dto'
import type { FormRules } from 'naive-ui'

/**
 * 书源表单的状态与回填。
 *
 * 从 SourceFormModal 抽出来的理由：那 6 个 ref 加上回填/清空/校验占了组件一半篇幅，
 * 而它们和模板没有关系——组件应该只剩「编排」（拉详情 → 填表单 → 提交）。
 *
 * 字段用顶层 ref 而不是一个 reactive 对象：模板里访问 reactive 的成员会让 vue-tsc
 * 误判成 ref 并插入 `.value`（book 的抽屉实测报 TS2339），顶层 ref 的模板绑定才是标准写法。
 * 调用方解构使用（`const { name, url } = useSourceForm()`），这样模板里的自动解包照常生效。
 */
export function useSourceForm() {
  const name = ref('')
  const url = ref('')

  /**
   * 站点编码：**没有输入框**，由「检测站点」自动识别后写入（见 useUrlProbe）。
   *
   * 但它必须一直存在并随表单提交：采集时正文解码、搜索关键词编码都要用它，
   * GBK 站不设就会静默乱码、搜不到结果。所以编辑态必须原样带回详情里的值——
   * 这是隐藏字段最容易踩的坑：漏提交等于把 gbk 悄悄改成默认 utf-8，站点当场坏掉。
   */
  const charset = ref('utf-8')

  const enabled = ref(true)
  const enabledExplore = ref(false)

  /** 采集配置（整个书源规则 JSON），详见 source-config.ts 顶部的说明 */
  const configJson = ref('{}')

  /** 清空成「新建」的初始值；重置按钮与打开抽屉时共用，保证两处一致 */
  function fillEmpty() {
    name.value = ''
    url.value = ''
    charset.value = 'utf-8'
    // 新建默认启用：建书源的目的就是用它，默认停用还得再点一下开关
    enabled.value = true
    enabledExplore.value = false
    configJson.value = '{}'
  }

  function fillFromDetail(detail: BookSourceDetail) {
    name.value = detail.bookSourceName
    url.value = detail.bookSourceUrl
    charset.value = detail.charset ?? 'utf-8'
    enabled.value = detail.enabled ?? false
    enabledExplore.value = detail.enabledExplore ?? false
    configJson.value = JSON.stringify(extractConfig(detail), null, 2)
  }

  /** JSON 文本的实时校验结果：非空即错误，提交按钮与 NFormItem 的 feedback 都用它 */
  const configError = computed(() => checkConfigJson(configJson.value))

  const formModel = computed(() => ({
    name: name.value,
    url: url.value,
  }))

  /** 与后端 zod 规则对齐：名称 1-255、地址 1-512 */
  const rules: FormRules = {
    name: [
      { required: true, message: '请输入书源名称', trigger: ['input', 'blur'] },
      { max: 255, message: '书源名称最多 255 字符', trigger: ['input', 'blur'] },
    ],
    url: [
      { required: true, message: '请输入书源地址', trigger: ['input', 'blur'] },
      { max: 512, message: '书源地址最多 512 字符', trigger: ['input', 'blur'] },
    ],
  }

  /**
   * 表单当前值 → 提交体。
   *
   * 拍平成值再交给纯函数，是为了让「提交什么」这件事能脱离组件单测
   * （见 source-config.test.ts）。调用前应确保 configError 为空。
   */
  function toPayload(): BookSourceInput {
    return buildSourcePayload({
      name: name.value,
      url: url.value,
      charset: charset.value,
      enabled: enabled.value,
      enabledExplore: enabledExplore.value,
      configJson: configJson.value,
    })
  }

  return {
    name,
    url,
    charset,
    enabled,
    enabledExplore,
    configJson,
    configError,
    formModel,
    rules,
    fillEmpty,
    fillFromDetail,
    toPayload,
  }
}
