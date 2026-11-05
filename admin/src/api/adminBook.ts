import { BOOK_ORIGINS, BOOK_ORIGIN_LABELS } from '@novel-plus/shared'
import type { BookOrigin } from '@novel-plus/shared'
import type {
  BookListResponse,
  BookMetadataPatch,
  BookSummary,
  CreateBookInput,
} from '@novel-plus/shared/dto'

import request from '@/utils/request'

/**
 * 书籍入库方式（crawl / author / manual）的值域与中文名来自 `@novel-plus/shared`，与后端同一份定义。
 *
 * 注意与「书源」区分：sourceId/sourceName 表示「从哪个站点采集」，origin 表示「这本书怎么进的库」。
 */
export { BOOK_ORIGINS, BOOK_ORIGIN_LABELS }
export type { BookOrigin }

/**
 * 书籍后台管理（`/api/admin/book`）。
 *
 * 行、请求体、列表响应的类型全部由 shared 的 zod schema 推出（`z.infer`）：
 * 后端加一个字段或改一个可空性，前端编译期就报错，不再依赖两份 interface 手工对齐。
 *
 * 只有**查询参数**是手写的——后端的 query schema 负责「URL 字符串 → 值」的 coerce，
 * 前端手里已经是强类型，硬套那份 schema 只会得到 `z.input` 的字符串类型，更差。
 */
export type AdminBook = BookSummary

export type AdminBookListResult = BookListResponse

/** 列表查询参数（形状与后端 listBookQuerySchema 对齐，但不复用它的 schema，原因见上） */
export interface AdminBookQuery {
  page: number
  pageSize: number
  /** 同时匹配书名与作者 */
  keyword?: string
  sourceId?: number
  /** 入库方式筛选 */
  origin?: BookOrigin
}

/**
 * 新增书籍（手动录入）。bookUrl / sourceId / tocUrl 只有建书时能定：
 * 编辑接口不接受它们——那是「这本书来自哪里」的身份信息，不是可随意改的元数据。
 */
export type CreateAdminBookParams = CreateBookInput

/** 编辑可改的字段（PATCH 语义：不传不改，传 null 清空） */
export type UpdateAdminBookParams = BookMetadataPatch

export async function getAdminBooks(params: AdminBookQuery) {
  return request<AdminBookListResult>({
    url: '/admin/book',
    method: 'get',
    // 空关键字会被后端当成「匹配空串」，直接剔掉让它走「不过滤」分支
    params: {
      ...params,
      keyword: params.keyword || undefined,
      sourceId: params.sourceId || undefined,
      origin: params.origin || undefined,
    },
  })
}

export async function getAdminBook(id: number) {
  return request<AdminBook>({
    url: `/admin/book/${id}`,
    method: 'get',
  })
}

export async function createAdminBook(data: CreateAdminBookParams) {
  return request<{ id: number }>({
    url: '/admin/book',
    method: 'post',
    data,
  })
}

/**
 * 更新书籍元数据。
 *
 * 用 PATCH 而不是 PUT：PUT 会把没传的元数据字段一律置为 null，
 * 而表单里只出现了一部分字段，用 PUT 等于「没在表单里的字段全被清空」。
 */
export async function updateAdminBook(id: number, data: UpdateAdminBookParams) {
  return request<{ id: number }>({
    url: `/admin/book/${id}`,
    method: 'patch',
    data,
  })
}

export async function deleteAdminBook(id: number) {
  return request<{ id: number; deleted: number }>({
    url: `/admin/book/${id}`,
    method: 'delete',
  })
}

export async function deleteAdminBooks(ids: number[]) {
  return request<{ deleted: number; ids: number[] }>({
    url: '/admin/book/batch-delete',
    method: 'post',
    data: { ids },
  })
}
