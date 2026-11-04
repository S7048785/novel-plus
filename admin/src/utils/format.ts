/**
 * 时间展示：后端返回 ISO 8601 字符串（MySQL datetime 序列化结果）。
 *
 * 解析失败时原样返回，而不是显示 "Invalid Date"——真出问题时，
 * 看到原始值才知道后端到底给了什么。
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
