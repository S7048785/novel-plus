/**
 * 书源模块的常量。
 *
 * 只放「页面里不随状态变化、且只有书源用」的东西：筛选值域、状态标签配色、表格宽度。
 * 分页候选是跨模块的，在 `@/constants/pagination`。
 */

/**
 * 启用状态筛选项。
 *
 * 下拉值用 'enabled' / 'disabled' 而不是布尔：naive-ui 的 NSelect 值域只有 `string | number`，
 * 布尔值会被类型系统拒掉。也不用 'true' / 'false' 字符串——那和后端 query schema 的字符串表示
 * 长得太像，容易被误当成「已经可以直接传」。真正的布尔转换只发生在 useSourceQuery 里一处。
 */
export type SourceEnabledFilter = 'enabled' | 'disabled'

export const SOURCE_ENABLED_FILTER_OPTIONS: Array<{
  label: string
  value: SourceEnabledFilter
}> = [
  { label: '已启用', value: 'enabled' },
  { label: '已停用', value: 'disabled' },
]

/**
 * 运行状态的文案与配色。
 *
 * status 是采集运行时写进去的观测值（0 可用 / 1 不可用），
 * 与「启用开关」是两件事：enabled 是人的意图（要不要用它采），
 * status 是系统的结论（上次跑挂了没有）。停用但上次成功 = enabled false + status 0。
 */
export const SOURCE_STATUS_LABELS: Record<number, string> = {
  0: '可用',
  1: '不可用',
}

export const SOURCE_STATUS_TAG_TYPE: Record<number, 'success' | 'error'> = {
  0: 'success',
  1: 'error',
}

/**
 * 表格横向滚动宽度 = 各列宽之和（selection 45 + 220 + 320 + 90 + 100 + 190 + 150）。
 *
 * 有固定列（操作列 `fixed: 'right'`）时，naive-ui 必须知道表格总宽度才会启用横向滚动；
 * 不给或给小了，列会被压扁换行而不是出现滚动条。改列宽时记得同步这里。
 *
 * 操作列从 200 收到 150 是因为「编辑」按钮移到了首列（点书源名称进编辑）。
 * comment（备注）刻意不上表格：它只在编辑抽屉里展示/编辑，列表页不需要。
 */
export const TABLE_SCROLL_X = 1150
