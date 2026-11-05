import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'

import { useDeleteUser, useDeleteUsers } from '@/features/user/queries'
import { getErrorMessage } from '@/utils/error'

/**
 * 用户表格的行选中与两个删除动作（结构同 book 的 useBookSelection）。
 *
 * 与书籍的唯一区别：用户 id 是 better-auth 生成的 32 位字符串，
 * 批量删除提交前要 `String(key)` 而不是 `Number(key)`——转成数字会变成 NaN，
 * 后端拿到的是一次「删 0 行」的静默成功。
 */
export function useUserSelection() {
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
  function removeSelected(id: string) {
    checkedRowKeys.value = checkedRowKeys.value.filter((key) => String(key) !== id)
  }

  const { isLoading: deleteLoading, mutate: mutateDeleteUser } = useDeleteUser({
    onSuccess: (result) => {
      message.success('已删除')
      removeSelected(result.id)
    },
    onError: (error) => message.error(getErrorMessage(error)),
  })

  const { isLoading: batchDeleteLoading, mutate: mutateDeleteUsers } = useDeleteUsers({
    onSuccess: (result) => {
      message.success(`已删除 ${result.deleted} 个用户`)
      // 批量删完选中的行都不在了，直接清空（不逐条剔除：可能分页都变了）
      clearSelection()
    },
    onError: (error) => message.error(getErrorMessage(error)),
  })

  /** 删除请求的 loading 合在一起：表格禁用与按钮禁用都用它 */
  const loading = computed(() => deleteLoading.value || batchDeleteLoading.value)

  function handleBatchDelete() {
    const ids = checkedRowKeys.value.map((key) => String(key))
    if (ids.length === 0) return
    mutateDeleteUsers(ids)
  }

  return {
    checkedRowKeys,
    hasSelection,
    loading,
    deleteLoading,
    batchDeleteLoading,
    mutateDeleteUser,
    handleBatchDelete,
    clearSelection,
  }
}
