import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'

import { useDeleteBook, useDeleteBooks } from '@/features/book/queries'
import { getErrorMessage } from '@/utils/error'

/**
 * 表格的行选中状态与两个删除动作。
 *
 * 选中只存 row key（书籍 id 是 number，但 NDataTable 的 checkedRowKeys 类型是
 * `Array<string | number>`，所以取用时统一 `Number(key)`），不存整行对象：
 * 列表刷新后对象会换成新引用，存对象反而会拿着过期数据。
 */
export function useBookSelection() {
  const message = useMessage()

  const checkedRowKeys = ref<Array<string | number>>([])

  const hasSelection = computed(() => checkedRowKeys.value.length > 0)

  function clearSelection() {
    checkedRowKeys.value = []
  }

  /**
   * 单条删除后把该行从选中里剔除。
   *
   * 不清的话会留下一个「指向已删除行」的 key：数据里已经没有它，但计数还在，
   * 批量删除按钮会显示「已选 1」却找不到是哪一行。
   */
  function removeSelected(id: number) {
    checkedRowKeys.value = checkedRowKeys.value.filter((key) => Number(key) !== id)
  }

  const { isLoading: deleteLoading, mutate: mutateDeleteBook } = useDeleteBook({
    onSuccess: (result) => {
      message.success('已删除')
      removeSelected(result.id)
    },
    onError: (error) => message.error(getErrorMessage(error)),
  })

  const { isLoading: batchDeleteLoading, mutate: mutateDeleteBooks } = useDeleteBooks({
    onSuccess: (result) => {
      message.success(`已删除 ${result.deleted} 本书`)
      // 批量删完选中的行都不在了，直接清空（不逐条剔除：可能分页都变了）
      clearSelection()
    },
    onError: (error) => message.error(getErrorMessage(error)),
  })

  /** 删除请求的 loading 合在一起：表格禁用与按钮禁用都用它 */
  const loading = computed(() => deleteLoading.value || batchDeleteLoading.value)

  function handleBatchDelete() {
    const ids = checkedRowKeys.value.map((key) => Number(key))
    if (ids.length === 0) return
    mutateDeleteBooks(ids)
  }

  return {
    checkedRowKeys,
    hasSelection,
    loading,
    deleteLoading,
    batchDeleteLoading,
    mutateDeleteBook,
    handleBatchDelete,
    clearSelection,
  }
}
