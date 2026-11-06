<script setup lang="ts">
import {
  NButton,
  NConfigProvider,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSpin,
  useMessage,
} from 'naive-ui'
import { computed, ref, useTemplateRef, watch } from 'vue'

import { createAdminChapter, updateAdminChapter } from '@/api'
import { useComponentThemeOverrides } from '@/composables'
import { useChapterDetail } from '@/features/book/queries'
import { getErrorMessage } from '@/utils/error'

import type { FormInst, FormRules } from 'naive-ui'

/**
 * 新增 / 编辑章节抽屉。
 *
 * 正文只在编辑时拉：列表接口刻意不返回 content（一章几 KB，整页带会把响应撑爆），
 * 所以这里用 useQuery + enabled 按需请求详情，关闭抽屉时数据留着也无妨（key 里带章节 id）。
 *
 * 字段语义严格对齐 server/src/admin/book/dto/chapter.schema.ts：
 * - index 留空：新增 = 后端自动追加到目录末尾；编辑 = 不改顺序（不传字段，不是传 0）；
 * - url 清空：提交 null = 清空源站地址；
 * - content 清空：提交 null = **删除正文**（编辑态在输入框下方明确提示，避免误删）。
 */
const props = defineProps<{
  show: boolean
  action: 'create' | 'update'
  bookId: number
  /** 编辑目标章节 id；新增时不需要 */
  chapterId?: number
}>()

const emits = defineEmits<{
  'update:show': [value: boolean]
  success: []
}>()

const message = useMessage()

const { overlayThemeOverrides } = useComponentThemeOverrides()

const formRef = useTemplateRef<FormInst>('formRef')

const submitting = ref(false)

const title = ref('')
const index = ref<number | null>(null)
const url = ref('')
const content = ref('')

const isEdit = computed(() => props.action === 'update')

const { data: detail, isLoading: detailLoading } = useChapterDetail(
  () => props.bookId,
  () => props.chapterId,
  () => props.show && props.action === 'update' && props.chapterId != null,
)

/** 编辑态回填：详情到达后灌进表单（列表行没有正文，不能只用行数据回填） */
function fillFromDetail(value: { title: string; index: number; url: string | null; content: string | null }) {
  title.value = value.title
  index.value = value.index
  url.value = value.url ?? ''
  content.value = value.content ?? ''
}

watch(detail, (value) => {
  if (value) fillFromDetail(value)
})

/** 新增/切换目标时清空，避免上一次编辑的内容串到下一本 */
watch(
  () => [props.show, props.action, props.chapterId] as const,
  ([show]) => {
    if (!show) return

    if (props.action === 'create') {
      title.value = ''
      index.value = null
      url.value = ''
      content.value = ''
    } else if (detail.value) {
      // 详情已在缓存里时 watch(detail) 不会再触发（引用没变），这里主动回填一次，
      // 否则重新打开同一章节会看到上次没保存的输入
      fillFromDetail(detail.value)
    }

    formRef.value?.restoreValidation()
  },
  { immediate: true },
)

const rules: FormRules = {
  title: [
    { required: true, message: '请输入章节标题', trigger: ['input', 'blur'] },
    { max: 512, message: '标题最多 512 字符', trigger: ['input', 'blur'] },
  ],
  url: [{ max: 512, message: '地址最多 512 字符', trigger: ['input', 'blur'] }],
}

/** 正文将被删除的提示：编辑态把已有正文清空提交，后端会真的删掉正文 */
const willClearContent = computed(
  () => isEdit.value && (detail.value?.content ?? '') !== '' && content.value.trim() === '',
)

/** 空串统一转 null：后端把 null 当「清空」，空串会原样入库 */
function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function handleClose() {
  emits('update:show', false)
}

async function handleSubmitClick() {
  try {
    await formRef.value?.validate()
  } catch {
    // 校验失败时 naive-ui 已在表单项下给出提示，不重复弹消息
    return
  }

  submitting.value = true
  try {
    if (isEdit.value && props.chapterId != null) {
      await updateAdminChapter(props.bookId, props.chapterId, {
        title: title.value.trim(),
        index: index.value ?? undefined,
        url: textOrNull(url.value),
        // 始终传正文：输入框里就是当前正文，清空 = 明确要删正文
        content: textOrNull(content.value),
      })
      message.success('已保存')
    } else {
      await createAdminChapter(props.bookId, {
        title: title.value.trim(),
        index: index.value ?? undefined,
        url: textOrNull(url.value),
        content: textOrNull(content.value),
      })
      message.success('已创建')
    }
    emits('success')
  } catch (error) {
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
      :width="720"
      @update:show="handleClose"
    >
      <NDrawerContent
        :title="isEdit ? '编辑章节' : '新增章节'"
        :native-scrollbar="false"
        closable
      >
        <NSpin :show="submitting || detailLoading">
          <NForm
            ref="formRef"
            :model="{ title, index, url, content }"
            :rules="rules"
            label-placement="top"
          >
            <NFormItem
              label="章节标题"
              path="title"
            >
              <NInput
                v-model:value="title"
                placeholder="必填，如：第 67 章 山雨欲来"
                clearable
              />
            </NFormItem>

            <div class="flex gap-x-4">
              <NFormItem
                label="章节序号"
                path="index"
                class="flex-1"
              >
                <NInputNumber
                  v-model:value="index"
                  :min="0"
                  :precision="0"
                  :placeholder="isEdit ? '留空则不改变顺序' : '留空则自动追加到末尾'"
                  class="w-full"
                />
              </NFormItem>
              <NFormItem
                label="源站地址"
                path="url"
                class="flex-[2]"
              >
                <NInput
                  v-model:value="url"
                  placeholder="可留空；清空则删除源站地址"
                  clearable
                />
              </NFormItem>
            </div>

            <NFormItem
              label="正文"
              path="content"
            >
              <div class="w-full">
                <NInput
                  v-model:value="content"
                  type="textarea"
                  placeholder="Markdown 正文，可留空"
                  :autosize="{ minRows: 12, maxRows: 24 }"
                />
                <div class="mt-1 flex justify-between text-xs opacity-60">
                  <span v-if="willClearContent" class="text-error">
                    正文将被清空：保存后这一章的正文会被删除（只留标题）。
                  </span>
                  <span v-else>正文按 Markdown 存储，客户端阅读时渲染</span>
                  <span>{{ content.length }} 字符</span>
                </div>
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
