import { BOOK_ORIGIN_LABELS } from '@/api'

import type { BookOrigin } from '@/api'

/**
 * 书籍模块的常量。
 *
 * 只放「页面里不随状态变化、且只有书籍用」的东西：标签配色、筛选项、表格宽度。
 * 分页候选是跨模块的，在 `@/constants/pagination`。
 */

/** 三种入库方式的标签配色：采集偏中性、作家上传提示色、手动导入信息色 */
export const ORIGIN_TAG_TYPE: Record<BookOrigin, 'default' | 'info' | 'success'> = {
  crawl: 'default',
  manual: 'info',
  author: 'success',
}

/** 入库方式筛选项（顺序由 BOOK_ORIGIN_LABELS 的键序决定，与后端值域一致） */
export const ORIGIN_FILTER_OPTIONS = (Object.keys(BOOK_ORIGIN_LABELS) as BookOrigin[]).map(
  (origin) => ({
    label: BOOK_ORIGIN_LABELS[origin],
    value: origin,
  }),
)

/**
 * 表格横向滚动宽度 = 各列宽之和（selection 列 + 8 个数据列 + 170 的操作列）。
 *
 * 有固定列（操作列 `fixed: 'right'`）时，naive-ui 必须知道表格总宽度才会启用横向滚动；
 * 不给或给小了，列会被压扁换行而不是出现滚动条。改列宽时记得同步这里。
 *
 * 操作列从 230 收到 170 是因为「编辑」按钮移到了首列（点书名进编辑）。
 */
export const TABLE_SCROLL_X = 1430
