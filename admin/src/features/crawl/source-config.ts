import type { BookSourceDetail, BookSourceInput } from '@novel-plus/shared/dto'

/**
 * 书源配置 ↔ 表单 的编解码规则。
 *
 * 单独成文件（不放在组件里）的原因：这段是纯数据变换，和 Vue 无关，
 * 但偏偏是最需要单测的部分——「编辑一次会不会把某个字段抹掉」「header 转没转成字符串」
 * 这类问题挂在组件上只能靠点 UI + 看 mock 参数间接验证。
 *
 * 分成两个方向：
 * - `extractConfig`：详情 → JSON 文本（编辑时回填）
 * - `buildSourcePayload`：表单 + JSON 文本 → 提交体
 */

/**
 * 表单维护的字段：JSON 里出现同名键会被忽略，避免两处互相覆盖。
 *
 * 反过来说，**不在这里的一切都会进 JSON**。这是刻意的：后端 json 列是 looseObject，
 * 书源规范会加字段，用白名单意味着每加一个都要改前端，漏改的后果是「编辑一次就把那个字段抹掉」。
 */
export const FORM_OWNED_KEYS = [
  'bookSourceName',
  'bookSourceUrl',
  'enabled',
  'enabledExplore',
  'charset',
  'id',
  'status',
] as const

/** 空串统一转 undefined：这些字段 schema 是 optional，传空串会原样入库成 "" */
export function textOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 字符串形式的 JSON 对象 → 对象；不是对象就返回 null（留给调用方决定退回原值） */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * 校验配置 JSON 文本，返回错误文案（空串 = 合法）。
 *
 * 空文本也算合法：那表示「这个书源没配任何采集配置」，不该拦着不让保存。
 */
export function checkConfigJson(text: string): string {
  if (text.trim() === '') return ''

  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return '配置必须是 JSON 对象，例如 { "searchUrl": "...", "ruleSearch": { ... } }'
    }
    return ''
  } catch (error) {
    return `JSON 格式错误：${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * 详情 → 采集配置对象（编辑时填进 JSON 文本域）。
 *
 * 黑名单式的提取：遍历详情的全部键，排除表单管的字段，其余原样保留。
 * 所以早期存进去、现在已经不在 schema 里声明的字段（如 bookSourceGroup）也会显示出来，
 * 用户看得见、也能自己删——「删掉表单字段」不等于「清空存量数据」。
 */
export function extractConfig(detail: BookSourceDetail): Record<string, unknown> {
  const config: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(detail as unknown as Record<string, unknown>)) {
    if ((FORM_OWNED_KEYS as readonly string[]).includes(key)) continue
    if (value === undefined || value === null || value === '') continue

    // 空的规则对象不写，让 JSON 短一点（后端对「没配置」和「空对象」的处理是一样的）
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      continue
    }

    // header 后端存的是 JSON 字符串，但本质是个键值对象：展示成对象比一串 \" 好读得多
    config[key] =
      key === 'header' && typeof value === 'string' ? (parseJsonObject(value) ?? value) : value
  }

  return config
}

/** 表单当前值（组件把 refs 拍平成值再交给 buildSourcePayload） */
export interface SourceFormSnapshot {
  name: string
  url: string
  charset: string
  enabled: boolean
  enabledExplore: boolean
  /** 采集配置的 JSON 文本，调用前应先过 checkConfigJson */
  configJson: string
}

/**
 * 表单 + JSON 文本 → 提交体。
 *
 * 两个必须保证的不变量：
 * 1. **表单字段优先**：JSON 里手写了 bookSourceName 之类，一律丢掉。否则会出现
 *    「表单里改了名称、保存后没生效」这种只能读代码才能解释的现象；
 * 2. **header 转回字符串**：展示时转成对象是为了好读，落库必须是后端期望的 JSON 字符串。
 */
export function buildSourcePayload(form: SourceFormSnapshot): BookSourceInput {
  const config = JSON.parse(form.configJson) as Record<string, unknown>

  for (const key of FORM_OWNED_KEYS) delete config[key]

  if (config.header !== null && typeof config.header === 'object') {
    config.header = JSON.stringify(config.header)
  }

  return {
    bookSourceName: form.name.trim(),
    bookSourceUrl: form.url.trim(),
    charset: textOrUndefined(form.charset),
    enabled: form.enabled,
    enabledExplore: form.enabledExplore,
    // 采集配置整段展开：后端 bookSourceSchema 是 looseObject，不认识的键也照样入库
    ...config,
  } as BookSourceInput
}
