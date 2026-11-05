import request from '@/utils/request'

/**
 * 书籍入库方式，与后端 server 的 common/book/origin.ts 一一对应。
 *
 * 注意与「书源」区分：sourceId/sourceName 表示「从哪个站点采集」，origin 表示「这本书怎么进的库」。
 */
export const BOOK_ORIGINS = ['crawl', 'author', 'manual'] as const

export type BookOrigin = (typeof BOOK_ORIGINS)[number]

export const BOOK_ORIGIN_LABELS: Record<BookOrigin, string> = {
  crawl: '爬虫采集',
  author: '作家上传',
  manual: '手动导入',
}

/**
 * 书籍后台管理（`/api/admin/book`）。
 *
 * 为什么手写而不是直接用 src/api/generated：生成产物是后端改造前的快照（路径还是 /api/book），
 * 等下次 `pnpm openapi` 之后可以把这里换成生成函数；在那之前以手写为准，字段与
 * server/src/admin/book/dto/*.schema.ts 一一对应。
 */

/** 列表/详情行：book 字段 + 书源名 + 已采集章节数 */
export interface AdminBook {
  id: number
  name: string
  author: string | null
  coverUrl: string | null
  /** 源站书籍地址；手动录入的书为 null */
  bookUrl: string | null
  sourceId: number | null
  /** 书源名；书源被删除后为 null */
  sourceName: string | null
  wordCount: string | null
  latestChapterTitle: string | null
  /** 源站标称的总章数（采集时抓到什么就是什么） */
  totalChapterNum: number | null
  tocUrl: string | null
  intro: string | null
  /** 入库方式：爬虫采集 / 作家上传 / 手动导入 */
  origin: BookOrigin
  /** 归属作家账号 id；null = 无主（采集入库的书、或账号被删后遗留） */
  authorId: string | null
  /** 归属作家的账号昵称；无主时为 null */
  authorName: string | null
  /** 实际落库的章节数，与 totalChapterNum 不是一回事 */
  chapterCount: number
  createdAt: string
  updatedAt: string
}

export interface AdminBookQuery {
  page: number
  pageSize: number
  /** 同时匹配书名与作者 */
  keyword?: string
  sourceId?: number
  /** 入库方式筛选 */
  origin?: BookOrigin
}

export interface AdminBookListResult {
  list: AdminBook[]
  total: number
  page: number
  pageSize: number
}

/**
 * 新增书籍（手动录入）。bookUrl / sourceId / tocUrl 只有建书时能定：
 * 编辑接口不接受它们——那是「这本书来自哪里」的身份信息，不是可随意改的元数据。
 */
export interface CreateAdminBookParams {
  name: string
  bookUrl?: string | null
  sourceId?: number | null
  tocUrl?: string | null
  author?: string | null
  coverUrl?: string | null
  intro?: string | null
  wordCount?: string | null
  latestChapterTitle?: string | null
  totalChapterNum?: number | null
  /** 入库方式；不传时后端按 manual（手动导入）处理 */
  origin?: BookOrigin
  /** 归属作家账号；不传 = 无主（服务端会校验该账号确实持有 author 身份） */
  authorId?: string | null
}

/** 编辑可改的字段（PATCH 语义：不传不改，传 null 清空） */
export interface UpdateAdminBookParams {
  name?: string
  author?: string | null
  coverUrl?: string | null
  intro?: string | null
  wordCount?: string | null
  latestChapterTitle?: string | null
  totalChapterNum?: number | null
  /** 入库方式；不传 = 不改 */
  origin?: BookOrigin
  /** 归属作家；不传 = 不改，传 null = 清空归属 */
  authorId?: string | null
}

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
