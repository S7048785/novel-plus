import type { AxiosError } from 'axios'

/**
 * 提取后端返回的错误提示。
 *
 * 服务端的异常响应体是 Nest 的默认结构 `{ statusCode, message, error }`，
 * message 在参数校验失败时是字符串数组（每条一个字段错误），其余情况是单个字符串。
 * 统一成一句可直接展示的文案，调用点就不用每处都写一遍类型收窄。
 */
export function getErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const axiosError = error as AxiosError<{ message?: string | string[] }>
  const raw = axiosError?.response?.data?.message

  if (Array.isArray(raw)) return raw.join('；')
  if (typeof raw === 'string' && raw) return raw

  // 网络错误（无 response）时 status 不存在，用 axios 自身的 message 兜底
  return axiosError?.message || fallback
}
