import { computed, reactive, ref, watch } from 'vue'

import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants/pagination'
import { useUserList } from '@/features/user/queries'

import type { AdminUser, AdminUserQuery, UserRole } from '@/api'
import type { PaginationProps } from 'naive-ui'

/**
 * 用户列表的查询状态（结构与 book 的 useBookQuery 一致，见那边的说明）。
 *
 * 刻意不复用成一个泛型 `useListQuery`：两个模块的筛选字段语义不同
 * （书籍按`入库方式`、用户按`身份`，且身份的筛选语义还得和文案一起解释），
 * 塞进泛型只会把差异藏起来，省下的 30 行换不来可读性。
 */
export function useUserQuery() {
  /** 输入框里的关键字（用户正在打的） */
  const keywordInput = ref('')

  /** 已生效的关键字（真正进 query 的） */
  const keyword = ref('')

  /** 身份筛选：null = 全部 */
  const roleFilter = ref<UserRole | null>(null)

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

  /** 列表查询条件：key 与请求参数必须来自同一份值，见 features/book/queries.ts 的说明 */
  const listQuery = computed<AdminUserQuery>(() => ({
    page: pagination.page ?? 1,
    pageSize: pagination.pageSize ?? DEFAULT_PAGE_SIZE,
    keyword: keyword.value || undefined,
    role: roleFilter.value ?? undefined,
  }))

  const { data, isLoading, refetch } = useUserList(() => listQuery.value)

  const userList = computed<AdminUser[]>(() => data.value?.list ?? [])

  // 总数同步给分页器（放 watch 而不是 computed：computed 里改外部状态会来回触发渲染）
  watch(data, (result) => {
    if (result) pagination.itemCount = result.total
  })

  /** 切身份筛选回到第一页：换了条件还停在旧页码会看到空列表 */
  watch(roleFilter, () => {
    pagination.page = 1
  })

  /**
   * 查询：关键字与页码变化会通过 query key 自动触发请求；
   * 只有「条件没变」（重复点查询 / 已在该页）时才手动 refetch，
   * 否则会出现一次点击发两个请求的情况。
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
      keyword.value === '' && roleFilter.value === null && (pagination.page ?? 1) === 1

    keywordInput.value = ''
    keyword.value = ''
    roleFilter.value = null
    pagination.page = 1

    if (unchanged) refetch()
  }

  return {
    keywordInput,
    keyword,
    roleFilter,
    pagination,
    listQuery,
    data,
    isLoading,
    refetch,
    userList,
    handleQuery,
    handleReset,
  }
}
