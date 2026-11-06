import { computed, reactive, ref, watch } from 'vue'

import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants/pagination'
import { useSourceList } from '@/features/crawl/queries'

import type { AdminBookSource, AdminBookSourceQuery } from '@/api'
import type { SourceEnabledFilter } from '@/features/crawl/constants'
import type { PaginationProps } from 'naive-ui'

/**
 * 书源列表的查询状态：关键字、启用筛选、分页，以及由它们派生出的请求。
 *
 * 结构同 features/book/composables/useBookQuery.ts：保留「输入框值」与「已生效值」两份 keyword，
 * 只有点查询 / 回车才把输入框的值提交成生效值（边打字边请求既浪费又会让列表闪烁）。
 */
export function useSourceQuery() {
  /** 输入框里的关键字（用户正在打的） */
  const keywordInput = ref('')

  /** 已生效的关键字（真正进 query 的） */
  const keyword = ref('')

  /**
   * 启用状态筛选：null = 全部。
   *
   * 类型是 `'enabled' | 'disabled' | null` 而不是 boolean：下拉组件（NSelect）的值域只有
   * string | number。NSelect 的 clearable 清空后给的是 null，所以这里必须带上 null 分支
   * （用 undefined 会漏掉这条，表现为「清空筛选没反应」）。
   */
  const enabledFilter = ref<SourceEnabledFilter | null>(null)

  /** 下拉值 → 后端要的布尔值；只在这一处转换，避免各页面各转一套 */
  const enabledQuery = computed<boolean | undefined>(() => {
    if (enabledFilter.value === null) return undefined
    return enabledFilter.value === 'enabled'
  })

  const pagination = reactive<PaginationProps>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    showSizePicker: true,
    pageSizes: PAGE_SIZES,
    itemCount: 0,
    showQuickJumper: true,
    // 页码/页大小写回 reactive 后，query key 变化会自动重新请求，不用手动 refetch
    onUpdatePage: (page) => {
      pagination.page = page
    },
    onUpdatePageSize: (pageSize) => {
      pagination.pageSize = pageSize
      pagination.page = 1
    },
  })

  /**
   * 列表查询条件。
   *
   * 做成 computed 而不是在 query 函数里现读：key 与请求参数必须来自同一份值，
   * 否则分页/筛选一变就可能出现「key 是新的、请求还是旧的」这种错配。
   */
  const listQuery = computed<AdminBookSourceQuery>(() => ({
    page: pagination.page ?? 1,
    pageSize: pagination.pageSize ?? DEFAULT_PAGE_SIZE,
    keyword: keyword.value || undefined,
    // 注意不能用 `|| undefined`：false 是有效筛选值（只看已停用），会被吞掉
    enabled: enabledQuery.value,
  }))

  const { data, isLoading, refetch } = useSourceList(() => listQuery.value)

  const sourceList = computed<AdminBookSource[]>(() => data.value?.list ?? [])

  // 总数同步给分页器（放 watch 而不是 computed：computed 里改外部状态会来回触发渲染）
  watch(data, (result) => {
    if (result) pagination.itemCount = result.total
  })

  /**
   * 切筛选回到第一页。
   *
   * 用 watch 而不是让工具栏 emit 一个 change 事件：这样「换了条件就回第一页」属于查询状态自己的约束，
   * 任何地方改 enabledFilter（重置、将来的 URL 回填）都会自动生效，不依赖调用方记得调。
   */
  watch(enabledFilter, () => {
    pagination.page = 1
  })

  /**
   * 查询：关键字与页码变化会通过 query key 自动触发请求；
   * 只有「条件没变」（重复点查询 / 已在该页）时才手动 refetch，避免一次点击发两个请求。
   */
  function handleQuery() {
    const nextKeyword = keywordInput.value.trim()
    const unchanged = nextKeyword === keyword.value && (pagination.page ?? 1) === 1

    pagination.page = 1
    keyword.value = nextKeyword

    if (unchanged) refetch()
  }

  function handleReset() {
    const unchanged =
      keyword.value === '' && enabledFilter.value === null && (pagination.page ?? 1) === 1

    keywordInput.value = ''
    keyword.value = ''
    enabledFilter.value = null
    pagination.page = 1

    if (unchanged) refetch()
  }

  return {
    keywordInput,
    keyword,
    enabledFilter,
    pagination,
    listQuery,
    data,
    isLoading,
    refetch,
    sourceList,
    handleQuery,
    handleReset,
  }
}
