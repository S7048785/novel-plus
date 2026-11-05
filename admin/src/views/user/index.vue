<script setup lang="ts">
import { NButton, NCard, NPopconfirm } from 'naive-ui'
import { computed, reactive } from 'vue'

import { ListQueryBar, ScrollContainer } from '@/components'
import { useComponentModifier, useInjection } from '@/composables'
import UserFormModal from '@/features/user/components/UserFormModal.vue'
import UserTable from '@/features/user/components/UserTable.vue'
import { useUserQuery } from '@/features/user/composables/useUserQuery'
import { useUserSelection } from '@/features/user/composables/useUserSelection'
import { ROLE_FILTER_OPTIONS } from '@/features/user/constants'
import { mediaQueryInjectionKey } from '@/injection'
import { toRefsUserStore } from '@/stores/user'

import type { AdminUser } from '@/api'

/**
 * 用户管理（`/api/admin/users`）：账号 CRUD + 身份授予。
 *
 * 这个文件只做**编排**，结构与书籍列表页一致：
 * - 查询条件与分页 → `useUserQuery`
 * - 行选中与删除 → `useUserSelection`
 * - 工具栏 → `UserQueryBar`，表格与分页器 → `UserTable`
 *
 * 页面级状态只剩「弹窗显隐」和「能不能改这个人的身份」两件事。
 */
defineOptions({
  name: 'UserList',
})

const { isMaxMd, isMaxLg } = useInjection(mediaQueryInjectionKey)

/** 当前登录账号：自己那行不能删，也不能改自己的身份 */
const { user: currentUser } = toRefsUserStore()

const { getPopconfirmModifier } = useComponentModifier()

const {
  keywordInput,
  roleFilter,
  pagination,
  isLoading,
  refetch,
  userList,
  handleQuery,
  handleReset,
} = useUserQuery()

const { checkedRowKeys, hasSelection, loading: deleting, mutateDeleteUser, handleBatchDelete } =
  useUserSelection()

/** 列表请求与删除请求任意一个在跑，就禁用交互：避免并发覆盖结果 */
const mergedLoading = computed(() => isLoading.value || deleting.value)

/**
 * 弹窗状态放在页面里而不是交给 useModal()：
 * 显隐是「编辑哪一行」的一部分，和 action/user 强相关，放在一个 reactive 里能保证三者同步。
 */
const formModal = reactive<{
  show: boolean
  action: 'create' | 'update'
  user?: AdminUser
}>({
  show: false,
  action: 'create',
  user: undefined,
})

/** 改自己的身份会让当前会话的权限立刻变化，后端拒绝，界面也禁掉勾选 */
const canEditRoles = computed(
  () => formModal.action === 'create' || formModal.user?.id !== currentUser.value?.id,
)

function openForm(action: 'create' | 'update', user?: AdminUser) {
  formModal.action = action
  formModal.user = user
  formModal.show = true
}

/** 弹窗里提交成功后：新增的用户排在第一页，已经在第一页只需刷新，否则改页码让它自动请求 */
function handleFormSuccess() {
  formModal.show = false

  if (formModal.action === 'create' && (pagination.page ?? 1) !== 1) {
    pagination.page = 1
  } else {
    refetch()
  }
}
</script>

<template>
  <ScrollContainer
    wrapper-class="flex flex-col gap-y-2"
    :scrollable="isMaxLg"
  >
    <NCard
      :size="isMaxMd ? 'small' : undefined"
      class="flex-1"
      content-class="flex flex-col"
    >
      <!-- 与书籍页一致：第一行查询条件、第二行操作按钮，避免左右互相覆盖 -->
      <div class="mb-2 flex flex-col gap-y-2 max-xl:mb-4">
        <ListQueryBar
          v-model:keyword="keywordInput"
          v-model:filter="roleFilter"
          :options="ROLE_FILTER_OPTIONS"
          placeholder="昵称或邮箱"
          filter-placeholder="全部身份"
          :input-width="320"
          :loading="isLoading"
          :disabled="mergedLoading"
          @query="handleQuery"
          @reset="handleReset"
        />
        <div class="flex justify-end gap-2">
          <NPopconfirm
            v-bind="getPopconfirmModifier()"
            positive-text="确定"
            negative-text="取消"
            @positive-click="handleBatchDelete"
          >
            <template #trigger>
              <NButton
                type="error"
                secondary
                :disabled="!hasSelection || mergedLoading"
              >
                <template #icon>
                  <span class="iconify ph--trash" />
                </template>
                删除所选（{{ checkedRowKeys.length }}）
              </NButton>
            </template>
            删除后这些账号无法登录，确认删除？
          </NPopconfirm>
          <NButton
            type="success"
            @click="openForm('create')"
          >
            <template #icon>
              <span class="iconify ph--plus-circle" />
            </template>
            新增用户
          </NButton>
        </div>
      </div>

      <UserTable
        v-model:checked-row-keys="checkedRowKeys"
        :data="userList"
        :loading="mergedLoading"
        :pagination="pagination"
        :self-id="currentUser?.id"
        @edit="openForm('update', $event)"
        @delete="mutateDeleteUser($event.id)"
      />
    </NCard>

    <UserFormModal
      v-model:show="formModal.show"
      :action="formModal.action"
      :user="formModal.user"
      :can-edit-roles="canEditRoles"
      @success="handleFormSuccess"
    />
  </ScrollContainer>
</template>
