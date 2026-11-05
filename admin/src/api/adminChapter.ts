import request from '@/utils/request'

/**
 * 章节后台管理（`/api/admin/book/:bookId/chapter`）。
 *
 * 章节挂在书下面：路由前缀自带 bookId，接口也全部带这个参数——
 * 后端会在 service 里校验「章节属于该书」，前端不要跨书拼 id。
 *
 * 字段对齐 server/src/admin/book/dto/chapter*.schema.ts：
 * - 列表行不带正文（一章正文几 KB，整页带上会把响应撑爆），只给 contentLength；
 * - 正文只在详情接口里返回，编辑时才拉一次。
 */

/** 列表行（不含正文） */
export interface AdminChapterSummary {
  id: number
  bookId: number
  title: string
  /** 源站章节地址；手动导入的章节为 null */
  url: string | null
  /** 章节在目录中的序号 */
  index: number
  /** 正文字数（CHAR_LENGTH）；无正文为 0 */
  contentLength: number
  createdAt: string
  updatedAt: string
}

/** 详情：列表字段 + 正文（Markdown） */
export interface AdminChapterDetail extends AdminChapterSummary {
  content: string | null
}

export interface AdminChapterQuery {
  page: number
  pageSize: number
}

export interface AdminChapterListResult {
  list: AdminChapterSummary[]
  total: number
  page: number
  pageSize: number
}

export interface CreateAdminChapterParams {
  title: string
  url?: string | null
  /** 不传 = 自动追加到目录末尾（由后端算最大值 +1） */
  index?: number
  content?: string | null
}

/**
 * 更新章节（PATCH 语义）：
 * - 不传 = 不改；
 * - url 传 null = 清空源站地址；
 * - content 传 null 或空串 = 删除正文。
 */
export interface UpdateAdminChapterParams {
  title?: string
  url?: string | null
  index?: number
  content?: string | null
}

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
