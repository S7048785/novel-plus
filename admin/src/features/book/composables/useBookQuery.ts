import { computed, reactive, ref, watch } from 'vue'

import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants/pagination'
import { useBookList } from '@/features/book/queries'

import type { AdminBook, AdminBookQuery, BookOrigin } from '@/api'
import type { PaginationProps } from 'naive-ui'

/**
 * 书籍列表的查询状态：关键字、筛选、分页，以及由它们派生出的请求。
 *
 * 这里刻意保留「输入框值」与「已生效值」两份 keyword：
 * 边打字边请求既浪费又会让列表闪烁，所以只有点查询 / 回车才把输入框的值提交成生效值。
 *
 * 页码/页大小写回 reactive 后，`listQuery` 变化会让 query key 跟着变，`useBookList` 自动重发请求——
 * 所以除了「条件没变」的那两种情况，都不需要手动 refetch。
 */
export function useBookQuery() {
  /** 输入框里的关键字（用户正在打的） */
  const keywordInput = ref('')

  /** 已生效的关键字（真正进 query 的） */
  const keyword = ref('')

  /** 入库方式筛选：null = 全部 */
  const originFilter = ref<BookOrigin | null>(null)

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
  const listQuery = computed<AdminBookQuery>(() => ({
    page: pagination.page ?? 1,
    pageSize: pagination.pageSize ?? DEFAULT_PAGE_SIZE,
    keyword: keyword.value || undefined,
    origin: originFilter.value ?? undefined,
  }))

  const { data, isLoading, refetch } = useBookList(() => listQuery.value)

  const bookList = computed<AdminBook[]>(() => data.value?.list ?? [])

  // 总数同步给分页器（放 watch 而不是 computed：computed 里改外部状态会来回触发渲染）
  watch(data, (result) => {
    if (result) pagination.itemCount = result.total
  })

  /**
   * 切筛选回到第一页。
   *
   * 用 watch 而不是让工具栏 emit 一个 change 事件：这样「换了条件就回第一页」属于查询状态自己的约束，
   * 任何地方改 originFilter（重置、将来的 URL 回填）都会自动生效，不依赖调用方记得调。
   */
  watch(originFilter, () => {
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
      keyword.value === '' &&
      originFilter.value === null &&
      (pagination.page ?? 1) === 1

    keywordInput.value = ''
    keyword.value = ''
    originFilter.value = null
    pagination.page = 1

    if (unchanged) refetch()
  }

  return {
    keywordInput,
    keyword,
    originFilter,
    pagination,
    listQuery,
    data,
    isLoading,
    refetch,
    bookList,
    handleQuery,
    handleReset,
  }
}
