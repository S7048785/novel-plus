import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'

import { useDeleteSource, useDeleteSources, useUpdateSource } from '@/features/crawl/queries'
import { getErrorMessage } from '@/utils/error'

/**
 * 表格的行选中状态、两个删除动作，以及行内的启用开关。
 *
 * 选中只存 row key（书源 id 是 number，NDataTable 的 checkedRowKeys 类型是
 * `Array<string | number>`，取用时统一 `Number(key)`），不存整行对象：
 * 列表刷新后对象会换成新引用，存对象反而会拿着过期数据。
 */
export function useSourceSelection() {
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

  const { isLoading: deleteLoading, mutate: mutateDeleteSource } = useDeleteSource({
    onSuccess: (result) => {
      message.success('已删除')
      removeSelected(result.id)
    },
    onError: (error) => message.error(getErrorMessage(error)),
  })

  const { isLoading: batchDeleteLoading, mutate: mutateDeleteSources } = useDeleteSources({
    onSuccess: (result) => {
      message.success(`已删除 ${result.deleted} 个书源`)
      // 批量删完选中的行都不在了，直接清空（不逐条剔除：可能分页都变了）
      clearSelection()
    },
    onError: (error) => message.error(getErrorMessage(error)),
  })

  /**
   * 行内启用开关。
   *
   * 走 PATCH 而不是 PUT：只提交 `{ enabled }` 就够了，规则体由后端保留。
   * 开关本身不做乐观更新——采集配置改错了代价不小，宁可等一次往返再变。
   */
  const { isLoading: toggleLoading, mutate: mutateToggleEnabled } = useUpdateSource({
    onSuccess: () => message.success('已保存'),
    onError: (error) => message.error(getErrorMessage(error)),
  })

  function handleToggleEnabled(id: number, enabled: boolean) {
    mutateToggleEnabled({ id, changes: { enabled } })
  }

  /** 三个请求的 loading 合在一起：表格禁用与按钮禁用都用它 */
  const loading = computed(
    () => deleteLoading.value || batchDeleteLoading.value || toggleLoading.value,
  )

  function handleBatchDelete() {
    const ids = checkedRowKeys.value.map((key) => Number(key))
    if (ids.length === 0) return
    mutateDeleteSources(ids)
  }

  return {
    checkedRowKeys,
    hasSelection,
    loading,
    deleteLoading,
    batchDeleteLoading,
    toggleLoading,
    mutateDeleteSource,
    handleBatchDelete,
    handleToggleEnabled,
    clearSelection,
  }
}
