declare interface ResponseBody<T = unknown> {
  code: number
  message: string
  data: T
}

/**
 * Nest 默认的错误响应体（异常过滤器输出）。
 *
 * 注意服务端没有业务 code 字段，HTTP status 就是唯一的状态信号；
 * message 在校验失败时是字符串数组（每个字段一条），所以两者都要兜住。
 */
declare interface ApiErrorBody {
  statusCode: number
  message: string | Array<string>
  error?: string
}

declare interface PaginationData<T = unknown> {
  list: T
  total: number
}

declare type PaginationRequestBody<T = unknown> = {
  page: number
  pageSize: number
  query: T & Record<string, unknown>
}
