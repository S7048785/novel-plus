import { useEventBus } from '@vueuse/core'

import { useDiscreteApi } from '@/composables'
import router from '@/router'
import { useUserStore } from '@/stores'

import type { AxiosError } from 'axios'

/**
 * 请求事件的载荷。
 *
 * 这里读的是 http status 而不是业务 code：服务端不返回 `{ code, message, data }` 信封，
 * 成功与否由 2xx / 非 2xx 表达，错误详情在 Nest 的 { statusCode, message } 里。
 */
export type RequestEventPayload =
  | { type: 'request' }
  | { type: 'requestError'; error: AxiosError<unknown, unknown> }
  | { type: 'response'; status: number; data: unknown }
  | { type: 'responseError'; error: AxiosError<ApiErrorBody, unknown>; code?: number }

export const requestEventBus = useEventBus<RequestEventPayload>('request')

/** Nest 的 message 可能是字符串，也可能是校验错误数组，统一取第一条 */
function readErrorMessage(body: ApiErrorBody | undefined, fallback: string) {
  if (!body) return fallback
  if (Array.isArray(body.message)) return body.message[0] ?? fallback
  return body.message || fallback
}

export function useRequestEventBus() {
  const { message: messageApi } = useDiscreteApi()
  const { cleanup } = useUserStore()

  requestEventBus.on((event) => {
    const currentPath = router.currentRoute.value.path
    switch (event.type) {
      case 'request':
        break

      case 'requestError':
        messageApi.error(`requestError: ${event.error.message}`)
        break

      case 'response':
        // 201 = 新建成功（POST 的默认状态码），给个轻提示；查询类不打扰
        if (event.status === 201) {
          messageApi.success('操作成功')
        }
        break

      case 'responseError':
        messageApi.error(readErrorMessage(event.error.response?.data, event.error.message))
        if (event.code === 401) {
          cleanup(currentPath)
        }
        break

      default:
        break
    }
  })
}
