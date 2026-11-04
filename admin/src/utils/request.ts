import axios, { type AxiosRequestConfig } from 'axios'

import { requestEventBus } from '@/event-bus'

/**
 * 登录态走 httpOnly cookie（better-auth 会话），而不是 Authorization 头。
 *
 * 所以这里不能读 localStorage 塞 token——token 根本不在前端手里，
 * 由浏览器自动携带 better-auth 的 session cookie。
 * withCredentials 必须为 true，否则跨源（前端 5799 / 后端 3000）时 cookie 不会被发送。
 *
 * baseURL 为 /api：服务端用 setGlobalPrefix('api') 把所有业务接口挂在 /api 下，
 * 与 better-auth 的 /api/auth/* 同前缀，所以下面的 url 只写 /admin/users、/auth/sign-in/email 即可。
 * 管理端接口带 /admin 前缀（`src/admin/` 目录的约定），将来作家端会是 /author。
 */
const axiosInstance = axios.create({
  baseURL: '/api',
  timeout: 10_000,
  withCredentials: true,
})

axiosInstance.interceptors.request.use(
  (config) => {
    requestEventBus.emit({ type: 'request' })
    return config
  },
  (error) => {
    requestEventBus.emit({ type: 'requestError', error })
    return Promise.reject(error)
  },
)

axiosInstance.interceptors.response.use(
  (response) => {
    requestEventBus.emit({ type: 'response', status: response.status, data: response.data })
    return response
  },
  (error) => {
    // Nest 的默认错误码就在 HTTP status 上（没有业务 code 字段），直接用它
    const code = error.response?.status
    requestEventBus.emit({ type: 'responseError', error, code })
    return Promise.reject(error)
  },
)

/**
 * 统一请求入口。
 *
 * 注意这里**没有** ResponseBody 信封：前端模板假设后端返回 `{ code, message, data }`，
 * 而服务端直接返回业务对象（列表就是 `{ list, total }`）。多套一层信封会让每个调用点
 * 都要多取一次 `.data`，也和 OpenAPI 生成的 SDK（src/api/generated）对不上。
 * 真要统一信封应该在后端加拦截器，而不是在前端伪造一层。
 */
export async function request<T = unknown>(config: AxiosRequestConfig) {
  const response = await axiosInstance.request<T>(config)
  return response.data
}

export default request
