import type {
  ChapterDetail,
  ChapterListResponse,
  ChapterSummary,
  CreateChapterInput,
  UpdateChapterInput,
} from '@novel-plus/shared/dto'

import request from '@/utils/request'

/**
 * 章节后台管理（`/api/admin/book/:bookId/chapter`）。
 *
 * 章节挂在书下面：路由前缀自带 bookId，接口也全部带这个参数——
 * 后端会在 service 里校验「章节属于该书」，前端不要跨书拼 id。
 *
 * 所有类型都由 shared 的 schema 推出（`z.infer`）：
 * - 列表行不带正文（一章正文几 KB，整页带上会把响应撑爆），只给 contentLength；
 * - 正文只在详情接口里返回，编辑时才拉一次。
 */
export type AdminChapterSummary = ChapterSummary

export type AdminChapterDetail = ChapterDetail

export type AdminChapterListResult = ChapterListResponse

/** 列表查询参数（手写：后端的 query schema 是 URL 字符串的适配层，前端不消费） */
export interface AdminChapterQuery {
  page: number
  pageSize: number
}

export type CreateAdminChapterParams = CreateChapterInput

/**
 * 更新章节（PATCH 语义）：
 * - 不传 = 不改；
 * - url 传 null = 清空源站地址；
 * - content 传 null 或空串 = 删除正文。
 */
export type UpdateAdminChapterParams = UpdateChapterInput

export async function getAdminChapters(bookId: number, params: AdminChapterQuery) {
  return request<AdminChapterListResult>({
    url: `/admin/book/${bookId}/chapter`,
    method: 'get',
    params,
  })
}

export async function getAdminChapter(bookId: number, chapterId: number) {
  return request<AdminChapterDetail>({
    url: `/admin/book/${bookId}/chapter/${chapterId}`,
    method: 'get',
  })
}

export async function createAdminChapter(bookId: number, data: CreateAdminChapterParams) {
  return request<{ id: number }>({
    url: `/admin/book/${bookId}/chapter`,
    method: 'post',
    data,
  })
}

export async function updateAdminChapter(
  bookId: number,
  chapterId: number,
  data: UpdateAdminChapterParams,
) {
  return request<{ id: number }>({
    url: `/admin/book/${bookId}/chapter/${chapterId}`,
    method: 'patch',
    data,
  })
}

export async function deleteAdminChapter(bookId: number, chapterId: number) {
  return request<{ id: number; deleted: number }>({
    url: `/admin/book/${bookId}/chapter/${chapterId}`,
    method: 'delete',
  })
}

export async function deleteAdminChapters(bookId: number, ids: number[]) {
  return request<{ deleted: number; ids: number[] }>({
    url: `/admin/book/${bookId}/chapter/batch-delete`,
    method: 'post',
    data: { ids },
  })
}
