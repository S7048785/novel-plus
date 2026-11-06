import type {
  BatchDeleteResponse,
  BatchDeleteSourceInput,
  BookSourceDetail,
  BookSourceInput,
  BookSourceListResponse,
  BookSourcePatch,
  CrawlSourceSummary,
  DeleteResponse,
  IdResponse,
  ProbeSourceInput,
  SourceProbeResponse,
  SourceTestResponse,
} from '@novel-plus/shared/dto'

import request from '@/utils/request'

/**
 * 书源管理（`/api/admin/crawl/source`）。
 *
 * 类型全部来自 shared 的 zod schema（`z.infer`），与后端同一份定义；
 * 只有**查询参数**是手写的——后端 query schema 负责「URL 字符串 → 值」的 coerce，
 * 前端手里已经是强类型，复用那份 schema 只会得到 `z.input` 的字符串类型。
 *
 * 注意两套字段名的差异（容易踩）：
 * - 列表行用 DB 列名 `sourceName` / `sourceUrl`；
 * - 详情与请求体用书源配置名 `bookSourceName` / `bookSourceUrl`。
 * 这是后端刻意保留的：列表投影的是列，详情投影的是 json 配置。前端不要在两者间自动映射，
 * 否则「少改一处」就会静默丢字段。
 */
export type AdminBookSource = CrawlSourceSummary

export type AdminBookSourceDetail = BookSourceDetail

export type AdminBookSourceListResult = BookSourceListResponse

/** 列表查询参数（形状与后端 listSourceQuerySchema 对齐） */
export interface AdminBookSourceQuery {
  page: number
  pageSize: number
  /** 同时匹配书源名称与地址 */
  keyword?: string
  /** 启用状态；不传 = 全部 */
  enabled?: boolean
}

/** 新增书源：整体配置（含规则体） */
export type CreateAdminBookSourceParams = BookSourceInput

/** 部分更新：只改标量字段，规则体原样保留 */
export type UpdateAdminBookSourceParams = BookSourcePatch

/** 全量覆盖：PUT，未携带的字段会被清空 */
export type ReplaceAdminBookSourceParams = BookSourceInput

export async function getAdminBookSources(params: AdminBookSourceQuery) {
  return request<AdminBookSourceListResult>({
    url: '/admin/crawl/source',
    method: 'get',
    // 空关键字会被后端当成「匹配空串」，直接剔掉让它走「不过滤」分支；
    // enabled 是布尔值，false 也必须保留，所以只在 undefined 时剔除
    params: {
      ...params,
      keyword: params.keyword || undefined,
      enabled: params.enabled ?? undefined,
    },
  })
}

/** 详情：含完整规则体（编辑规则用） */
export async function getAdminBookSource(id: number) {
  return request<AdminBookSourceDetail>({
    url: `/admin/crawl/source/${id}`,
    method: 'get',
  })
}

export async function createAdminBookSource(data: CreateAdminBookSourceParams) {
  return request<IdResponse>({
    url: '/admin/crawl/source',
    method: 'post',
    data,
  })
}

/**
 * 部分更新（PATCH）：只覆盖请求里出现的字段。
 *
 * 列表页的启用开关、表单里的标量字段都走这里，规则体不受影响。
 */
export async function updateAdminBookSource(id: number, data: UpdateAdminBookSourceParams) {
  return request<IdResponse>({
    url: `/admin/crawl/source/${id}`,
    method: 'patch',
    data,
  })
}

/**
 * 全量覆盖（PUT）：请求体就是最终配置，未携带的字段会被清空。
 *
 * 只有「编辑规则」用这个——那时请求体来自详情接口的完整配置，
 * 不会被误清；表单里改标量请用 PATCH。
 */
export async function replaceAdminBookSource(id: number, data: ReplaceAdminBookSourceParams) {
  return request<IdResponse>({
    url: `/admin/crawl/source/${id}`,
    method: 'put',
    data,
  })
}

/** 删除书源：只删配置，已采集的书籍保留 */
export async function deleteAdminBookSource(id: number) {
  return request<DeleteResponse>({
    url: `/admin/crawl/source/${id}`,
    method: 'delete',
  })
}

export async function deleteAdminBookSources(ids: number[]) {
  return request<BatchDeleteResponse>({
    url: '/admin/crawl/source/batch-delete',
    method: 'post',
    data: { ids } satisfies BatchDeleteSourceInput,
  })
}

/**
 * 探测站点是否可访问。
 *
 * 与 testAdminBookSource 的区别：那个要书源已存在（有 id）且配了规则，验证的是「规则对不对」；
 * 这个只认一个地址，新增书源时就能用，验证的是「站点活不活」。
 *
 * 后端不会因为它「返回 403」就抛错——状态码、耗时、标题都在响应里，由界面决定怎么展示。
 */
export async function probeAdminBookSourceUrl(data: ProbeSourceInput) {
  return request<SourceProbeResponse>({
    url: '/admin/crawl/source/probe',
    method: 'post',
    data,
  })
}

/**
 * 测试书源：用关键词跑一次搜索。
 *
 * 后端把抓取异常也包成 `ok: false` 的正常响应返回，所以这里不会因为「站点挂了」而抛错——
 * 业务失败看响应里的 ok / error 字段，不要指望 catch。
 */
export async function testAdminBookSource(id: number, key: string, page?: number) {
  return request<SourceTestResponse>({
    url: `/admin/crawl/source/${id}/test`,
    method: 'post',
    data: { key, page },
  })
}
