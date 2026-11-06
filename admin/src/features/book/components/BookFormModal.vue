<script setup lang="ts">
import {
  NAvatar,
  NButton,
  NConfigProvider,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSpin,
  useMessage,
} from 'naive-ui'
import { computed, ref, useTemplateRef, watch } from 'vue'

import { BOOK_ORIGINS, BOOK_ORIGIN_LABELS, createAdminBook, updateAdminBook } from '@/api'
import { useComponentThemeOverrides } from '@/composables'
import { getErrorMessage } from '@/utils/error'

import type { AdminBook, BookOrigin } from '@/api'
import type { FormInst, FormRules } from 'naive-ui'

/**
 * 新增 / 编辑书籍抽屉（右侧滑出，长表单在内容区内部滚动）。
 *
 * 字段范围严格对齐后端 DTO（server/src/admin/book/dto/book.payload.schema.ts）：
 * - 新增可以带 bookUrl / tocUrl——它们回答「这本书来自哪里」，只有建书时能定；
 * - 编辑只能改元数据（书名、作者、封面、简介、字数、最新章节、总章数），后端 PATCH 不接其余字段，
 *   所以编辑态把来源信息做成只读展示，而不是给一个「填了也存不进去」的输入框；
 * - 归属作家（authorId）：下拉候选由父组件传入（只有持有 author 身份的账号），
 *   清空下拉 = 提交 null = 把书变回无主。编辑打开时不动它，提交原值，归属不会被误清。
 *
 * 每个字段一个顶层 ref，而不是一个 reactive 对象：模板里访问 reactive 的成员会让 vue-tsc
 * 误判成 ref 并插入 `.value`（本文件实测报 TS2339），顶层 ref 的模板绑定则是标准写法。
 * 校验需要整体 model，用 computed 的 formModel 拼出来。
 */
const props = defineProps<{
  show: boolean
  action: 'create' | 'update'
  book?: AdminBook
  /** 作家候选（父组件统一拉取，抽屉不重复请求） */
  authorOptions?: Array<{ label: string; value: string }>
}>()

const emits = defineEmits<{
  'update:show': [value: boolean]
  success: []
}>()

const message = useMessage()

const { overlayThemeOverrides } = useComponentThemeOverrides()

const formRef = useTemplateRef<FormInst>('formRef')

const submitting = ref(false)

const name = ref('')
const author = ref('')
const bookUrl = ref('')
const tocUrl = ref('')
const coverUrl = ref('')
const intro = ref('')
const wordCount = ref('')
const latestChapterTitle = ref('')
const totalChapterNum = ref<number | null>(null)
/** 入库方式：新建默认「手动导入」（从后台手填进来的就是这种） */
const origin = ref<BookOrigin>('manual')
/** 归属作家账号；null = 无主 */
const authorId = ref<string | null>(null)

const originOptions = BOOK_ORIGINS.map((value) => ({ label: BOOK_ORIGIN_LABELS[value], value }))

/** 给 NForm 做校验用的整体 model（naive-ui 按 path 从这里取字段） */
const formModel = computed(() => ({
  name: name.value,
  author: author.value,
  bookUrl: bookUrl.value,
  tocUrl: tocUrl.value,
  coverUrl: coverUrl.value,
  intro: intro.value,
  wordCount: wordCount.value,
  latestChapterTitle: latestChapterTitle.value,
  totalChapterNum: totalChapterNum.value,
  origin: origin.value,
  authorId: authorId.value,
}))

const isEdit = computed(() => props.action === 'update')

/** 与后端 zod 规则对齐：书名必填 1-255，其余按列宽给上限 */
const rules: FormRules = {
  name: [
    { required: true, message: '请输入书名', trigger: ['input', 'blur'] },
    { max: 255, message: '书名最多 255 字符', trigger: ['input', 'blur'] },
  ],
  author: [{ max: 255, message: '作者最多 255 字符', trigger: ['input', 'blur'] }],
  bookUrl: [{ max: 512, message: '地址最多 512 字符', trigger: ['input', 'blur'] }],
  tocUrl: [{ max: 512, message: '地址最多 512 字符', trigger: ['input', 'blur'] }],
  coverUrl: [{ max: 512, message: '封面地址最多 512 字符', trigger: ['input', 'blur'] }],
  wordCount: [{ max: 64, message: '字数最多 64 字符', trigger: ['input', 'blur'] }],
  latestChapterTitle: [{ max: 255, message: '章节名最多 255 字符', trigger: ['input', 'blur'] }],
}

/** 清空成「新建」的初始值；重置按钮与 watch 共用，保证两处一致 */
function fillEmpty() {
  name.value = ''
  author.value = ''
  bookUrl.value = ''
  tocUrl.value = ''
  coverUrl.value = ''
  intro.value = ''
  wordCount.value = ''
  latestChapterTitle.value = ''
  totalChapterNum.value = null
  origin.value = 'manual'
  authorId.value = null
}

watch(
  () => props.book,
  (book) => {
    if (!book) {
      fillEmpty()
      return
    }

    name.value = book.name
    author.value = book.author ?? ''
    bookUrl.value = book.bookUrl ?? ''
    tocUrl.value = book.tocUrl ?? ''
    coverUrl.value = book.coverUrl ?? ''
    intro.value = book.intro ?? ''
    wordCount.value = book.wordCount ?? ''
    latestChapterTitle.value = book.latestChapterTitle ?? ''
    totalChapterNum.value = book.totalChapterNum
    origin.value = book.origin
    authorId.value = book.authorId
  },
  { immediate: true },
)

/** 每次打开都清掉上一次的校验红字 */
watch(
  () => props.show,
  (show) => {
    if (show) formRef.value?.restoreValidation()
  },
)

/** 空串统一转 null：后端把 null 当「清空」，空串会原样入库 */
function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function handleClose() {
  emits('update:show', false)
}

function handleReset() {
  fillEmpty()
  formRef.value?.restoreValidation()
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
    if (isEdit.value && props.book) {
      await updateAdminBook(props.book.id, {
        name: name.value.trim(),
        author: textOrNull(author.value),
        coverUrl: textOrNull(coverUrl.value),
        intro: textOrNull(intro.value),
        wordCount: textOrNull(wordCount.value),
        latestChapterTitle: textOrNull(latestChapterTitle.value),
        totalChapterNum: totalChapterNum.value,
        origin: origin.value,
        // 始终传：没动过就是原值（无副作用），清空下拉传 null = 显式取消归属
        authorId: authorId.value,
      })
      message.success('已保存')
    } else {
      await createAdminBook({
        name: name.value.trim(),
        author: textOrNull(author.value),
        bookUrl: textOrNull(bookUrl.value),
        tocUrl: textOrNull(tocUrl.value),
        coverUrl: textOrNull(coverUrl.value),
        intro: textOrNull(intro.value),
        wordCount: textOrNull(wordCount.value),
        latestChapterTitle: textOrNull(latestChapterTitle.value),
        totalChapterNum: totalChapterNum.value,
        origin: origin.value,
        authorId: authorId.value,
      })
      message.success('已创建')
    }
    emits('success')
  } catch (error) {
    // 重复书籍（409）、书源不存在（400）这类业务错误必须展示出来
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
      :width="640"
      @update:show="handleClose"
    >
      <NDrawerContent
        :title="isEdit ? '编辑书籍' : '新增书籍'"
        :native-scrollbar="false"
        closable
      >
        <NSpin :show="submitting">
        <NForm
          ref="formRef"
          :model="formModel"
          :rules="rules"
          label-placement="left"
          label-width="88px"
        >
          <NFormItem
            label="书名"
            path="name"
          >
            <NInput
              v-model:value="name"
              placeholder="必填"
              clearable
            />
          </NFormItem>
          <NFormItem
            label="作者"
            path="author"
          >
            <NInput
              v-model:value="author"
              placeholder="源站作者名，可留空"
              clearable
            />
          </NFormItem>

          <NFormItem
            v-if="!isEdit"
            label="源站地址"
            path="bookUrl"
          >
            <NInput
              v-model:value="bookUrl"
              placeholder="https://…，手动录入的书可留空"
              clearable
            />
          </NFormItem>
          <NFormItem
            v-if="!isEdit"
            label="目录页"
            path="tocUrl"
          >
            <NInput
              v-model:value="tocUrl"
              placeholder="目录页地址，可留空"
              clearable
            />
          </NFormItem>
          <NFormItem
            label="入库方式"
            path="origin"
          >
            <NSelect
              v-model:value="origin"
              :options="originOptions"
              class="w-full"
            />
          </NFormItem>
          <NFormItem
            label="归属作家"
            path="authorId"
          >
            <NSelect
              v-model:value="authorId"
              :options="authorOptions ?? []"
              placeholder="选择作家账号，可留空（无主）"
              clearable
              filterable
              class="w-full"
            />
          </NFormItem>
          <NFormItem
            v-if="isEdit"
            label="书源"
          >
            <div class="flex w-full flex-col gap-y-1 text-sm">
              <span>书源：{{ book?.sourceName ?? '（无，手动录入）' }}</span>
              <span class="truncate opacity-60">源站：{{ book?.bookUrl ?? '—' }}</span>
              <span class="text-xs opacity-50">来源信息建书后不可修改</span>
            </div>
          </NFormItem>

          <NFormItem
            label="封面"
            path="coverUrl"
          >
            <div class="flex w-full items-center gap-x-3">
              <NAvatar
                :src="coverUrl || undefined"
                :size="40"
                object-fit="cover"
                class="shrink-0 rounded"
              >
                {{ name.slice(0, 1) || '书' }}
              </NAvatar>
              <NInput
                v-model:value="coverUrl"
                placeholder="封面图片地址，可留空"
                clearable
                class="flex-1"
              />
            </div>
          </NFormItem>
          <NFormItem
            label="简介"
            path="intro"
          >
            <NInput
              v-model:value="intro"
              type="textarea"
              placeholder="可留空"
              :autosize="{ minRows: 3, maxRows: 6 }"
            />
          </NFormItem>
          <NFormItem
            label="字数"
            path="wordCount"
          >
            <NInput
              v-model:value="wordCount"
              placeholder="源站展示的字数，如 25.9 万"
              clearable
            />
          </NFormItem>
          <NFormItem
            label="最新章节"
            path="latestChapterTitle"
          >
            <NInput
              v-model:value="latestChapterTitle"
              placeholder="可留空"
              clearable
            />
          </NFormItem>
          <NFormItem
            label="总章数"
            path="totalChapterNum"
          >
            <NInputNumber
              v-model:value="totalChapterNum"
              :min="0"
              :precision="0"
              placeholder="源站标称的总章数，可留空"
              class="w-full"
            />
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
            :disabled="submitting"
            @click="handleReset"
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
