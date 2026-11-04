<script setup lang="ts">
import {
  NAvatar,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NConfigProvider,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NSpin,
  useMessage,
} from 'naive-ui'
import { computed, ref, useTemplateRef, watch } from 'vue'

import { createAdminUser, updateAdminUser } from '@/api'
import { useComponentThemeOverrides, useResettableReactive } from '@/composables'
import { getErrorMessage } from '@/utils/error'

import type { AdminUser, UserRole } from '@/api'
import type { FormInst, FormRules } from 'naive-ui'

/**
 * 新增 / 编辑用户抽屉（右侧滑出）。
 *
 * 用声明式 NDrawer 而不是 useModal()/useDrawer() 这类命令式 API：
 * 后者的 content 是「返回 vnode 的函数」，naive-ui 会在渲染函数之外调用它，
 * Vue 3.5 会告警「Slot "default" invoked outside of the render function」，
 * 并且弹层的显隐被藏在 provider 的闭包里，开关时机不好控制。
 * 表单类内容用抽屉而非居中弹窗：抽屉高度天然固定、表单在内容区内部滚动，
 * 不会出现「长表单把弹窗撑到和视口一样高、靠滚动页面来看全」的问题。
 *
 * 编辑时直接用列表里已有的行数据回填，不额外发一次详情请求：
 * 列表返回的字段就是详情返回的全部字段，多打一次接口只是在制造加载态。
 *
 * 密码只在「新增」时出现——后端没有重置密码接口，编辑态的密码框会是个假控件。
 */
const props = defineProps<{
  show: boolean
  action: 'create' | 'update'
  user?: AdminUser
  /**
   * 能否调整身份。管理员不能改自己的身份（后端也会拒绝）：
   * 把自己降成读者，下一个请求就进不来后台了。前端同步禁用只是让这件事看起来合理，
   * 真正的拦截在 service 里。
   */
  canEditRoles?: boolean
}>()

const emits = defineEmits<{
  'update:show': [value: boolean]
  success: []
}>()

const message = useMessage()

const { overlayThemeOverrides } = useComponentThemeOverrides()

const formRef = useTemplateRef<FormInst>('formRef')

const submitting = ref(false)

/**
 * 表单里的身份：始终包含 reader（界面上不可取消），author/admin 可勾选。
 * 提交时只把附加身份发给后端，reader 由服务端补齐。
 */
const [form, setForm, reset, updateInitialState] = useResettableReactive<{
  name: string
  email: string
  password: string
  image: string
  roles: UserRole[]
}>({
  name: '',
  email: '',
  password: '',
  image: '',
  roles: ['reader'],
})


const isEdit = computed(() => props.action === 'update')

/** 与后端 zod 规则对齐：密码 8-64 位、昵称 1-255、邮箱格式 */
const rules = computed<FormRules>(() => ({
  name: [
    { required: true, message: '请输入昵称', trigger: ['input', 'blur'] },
    { max: 255, message: '昵称最多 255 字符', trigger: ['input', 'blur'] },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: ['input', 'blur'] },
    { type: 'email', message: '邮箱格式不正确', trigger: ['input', 'blur'] },
  ],
  ...(isEdit.value
    ? {}
    : {
        password: [
          { required: true, message: '请输入密码', trigger: ['input', 'blur'] },
          { min: 8, message: '密码至少 8 位', trigger: ['input', 'blur'] },
          { max: 64, message: '密码最多 64 位', trigger: ['input', 'blur'] },
        ],
      }),
}))

watch(
  () => props.user,
  (user) => {
    const initial = user
      ? {
          name: user.name,
          email: user.email,
          password: '',
          image: user.image ?? '',
          roles: [...user.roles],
        }
      : { name: '', email: '', password: '', image: '', roles: ['reader' as UserRole] }

    setForm(initial)
    updateInitialState(initial)
  },
  { immediate: true },
)

/** 每次打开都清掉上一次的校验红字，避免关掉再开还挂着旧错误 */
watch(
  () => props.show,
  (show) => {
    if (show) formRef.value?.restoreValidation()
  },
)

/** 提交给后端的只有附加身份：reader 是基础身份，由服务端补齐 */
function assignableRoles(): UserRole[] {
  return form.roles.filter((role) => role !== 'reader')
}

function handleClose() {
  emits('update:show', false)
}

async function handleSubmitClick() {
  try {
    await formRef.value?.validate()
  } catch {
    // 校验失败时 naive-ui 已在表单项下给出提示，这里不重复弹消息
    return
  }

  submitting.value = true
  try {
    if (isEdit.value && props.user) {
      await updateAdminUser(props.user.id, {
        name: form.name,
        email: form.email,
        // 空串表示「清空头像」，转成 null 才是后端的语义
        image: form.image.trim() ? form.image.trim() : null,
        // 不能改自己身份时不带 roles：后端会拒绝，带上只会换来一个 400
        ...(props.canEditRoles === false ? {} : { roles: assignableRoles() }),
      })
      message.success('已保存')
    } else {
      await createAdminUser({
        name: form.name,
        email: form.email,
        password: form.password,
        image: form.image.trim() ? form.image.trim() : null,
        roles: assignableRoles(),
      })
      message.success('已创建')
    }
    emits('success')
  } catch (error) {
    // 邮箱重复（409）、改自己身份（400）这类业务错误必须展示出来，否则用户只会看到「没反应」
    message.error(getErrorMessage(error))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <NConfigProvider :theme-overrides="overlayThemeOverrides">
    <NDrawer
      :show="show"
      placement="right"
      :width="520"
      @update:show="handleClose"
    >
      <NDrawerContent
        :title="isEdit ? '编辑用户' : '新增用户'"
        closable
      >
        <NSpin :show="submitting">
        <NForm
          ref="formRef"
          :model="form"
          :rules="rules"
          label-placement="left"
          label-width="72px"
        >
          <NFormItem
            label="昵称"
            path="name"
          >
            <NInput
              v-model:value="form.name"
              placeholder="登录后展示的名字"
              clearable
            />
          </NFormItem>
          <NFormItem
            label="邮箱"
            path="email"
          >
            <NInput
              v-model:value="form.email"
              placeholder="登录账号（唯一）"
              clearable
            />
          </NFormItem>
          <NFormItem
            v-if="!isEdit"
            label="密码"
            path="password"
          >
            <NInput
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              placeholder="8-64 位，创建后不可在此修改"
              clearable
            />
          </NFormItem>
          <NFormItem
            label="头像"
            path="image"
          >
            <div class="flex w-full items-center gap-x-3">
              <NAvatar
                :src="form.image || undefined"
                round
                :size="36"
              >
                {{ form.name.slice(0, 1) || '?' }}
              </NAvatar>
              <NInput
                v-model:value="form.image"
                placeholder="图片地址，留空则不显示头像"
                clearable
                class="flex-1"
              />
            </div>
          </NFormItem>
          <NFormItem
            label="身份"
            path="roles"
          >
            <div class="w-full">
              <NCheckboxGroup
                v-model:value="form.roles"
                :disabled="canEditRoles === false"
              >
                <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <!-- 读者是所有账号的基础身份，勾上且锁死，避免出现「没有任何身份」的账号 -->
                  <NCheckbox
                    value="reader"
                    disabled
                  >
                    读者
                  </NCheckbox>
                  <NCheckbox value="author">作家</NCheckbox>
                  <NCheckbox value="admin">管理员</NCheckbox>
                </div>
              </NCheckboxGroup>
              <p class="mt-1 text-xs opacity-60">
                <template v-if="canEditRoles === false">
                  不能修改自己的身份：把自己降级会立刻失去后台访问权限。
                </template>
                <template v-else>
                  读者为所有账号必备；作家只能通过接口管理自己名下的书（后台仅限管理员登录）；
                  管理员拥有全部权限。
                </template>
              </p>
            </div>
          </NFormItem>
        </NForm>
      </NSpin>

      <template #footer>
        <div class="flex justify-end gap-x-4">
          <NButton
            secondary
            @click="handleClose"
          >
            取消
          </NButton>
          <NButton
            secondary
            type="warning"
            @click="
              () => {
                reset()
                formRef?.restoreValidation()
              }
            "
          >
            重置
          </NButton>
          <NButton
            type="success"
            :loading="submitting"
            :disabled="submitting"
            @click="handleSubmitClick"
          >
            确定
          </NButton>
        </div>
      </template>
      </NDrawerContent>
    </NDrawer>
  </NConfigProvider>
</template>
