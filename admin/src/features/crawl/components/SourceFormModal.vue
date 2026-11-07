<script setup lang="ts">
import {
  NButton,
  NConfigProvider,
  NDivider,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NInput,
  NSpin,
  NSwitch,
  useMessage,
} from 'naive-ui'
import { computed, useTemplateRef, watch } from 'vue'

import { useComponentThemeOverrides } from '@/composables'
import { useSourceForm } from '@/features/crawl/composables/useSourceForm'
import { useUrlProbe } from '@/features/crawl/composables/useUrlProbe'
import { useCreateSource, useReplaceSource, useSourceDetail } from '@/features/crawl/queries'
import { getErrorMessage } from '@/utils/error'

import SourceProbeAlert from './SourceProbeAlert.vue'

import type { FormInst } from 'naive-ui'

/**
 * 新增 / 编辑书源抽屉。
 *
 * 这个文件只做**编排**，不持有表单状态：
 * - 表单字段、回填、校验 → `useSourceForm`
 * - 「检测站点」与编码自动识别 → `useUrlProbe`
 * - 详情与两个写接口 → `queries.ts`
 * - 配置 ↔ 表单的编解码规则（纯函数，可单测）→ `source-config.ts`
 *
 * 为什么整份配置用一个 JSON 文本域：`searchUrl` / `header` / `jsLib` / 五组 ruleXxx
 * 本来就是同一份书源配置里的兄弟字段，拆成多个表单区块会让「改个搜索地址」都得先判断归哪类。
 * 划分原则只有一条：表单管「这条书源是谁、要不要用」，JSON 管「怎么抓、怎么解析」。
 */
const props = defineProps<{
  show: boolean
  action: 'create' | 'update'
  /** 编辑时的书源 id；新增时不传 */
  sourceId?: number
}>()

const emits = defineEmits<{
  'update:show': [value: boolean]
  success: []
}>()

const message = useMessage()

const { overlayThemeOverrides } = useComponentThemeOverrides()

const formRef = useTemplateRef<FormInst>('formRef')

const isEdit = computed(() => props.action === 'update')

/**
 * 编辑时拉完整详情。列表接口不返回规则体（一行几 KB），所以必须单独取一次。
 * `enabled` 用函数：抽屉关着或新增时不该发请求。
 */
const { data: detailData, isLoading: detailLoading } = useSourceDetail(
  () => props.sourceId,
  () => props.show && isEdit.value,
)

const { mutateAsync: createSource, isLoading: creating } = useCreateSource()
const { mutateAsync: replaceSource, isLoading: replacing } = useReplaceSource()

const submitting = computed(() => creating.value || replacing.value)

/**
 * 解构出来用，而不是 `const form = useSourceForm()`：
 * 模板里只有**顶层绑定**会自动解包 ref，写成 `form.name` 拿到的仍是 Ref 对象，
 * v-model 会把整个 ref 传下去。
 */
const {
  name,
  url,
  charset,
  enabled,
  enabledExplore,
  comment,
  configJson,
  configError,
  formModel,
  rules,
  fillEmpty,
  fillFromDetail,
  toPayload,
} = useSourceForm()

const { probing, probeResult, probe: handleProbe } = useUrlProbe({
  url,
  charset,
  originalUrl: () => detailData.value?.bookSourceUrl,
})

/**
 * 抽屉打开时复位。
 *
 * 新增直接清空；编辑**不能**只靠下面那个 watch(detailData)：
 * 详情命中缓存时值没有「变化」，watch 不会触发，表单会留着上一次的内容
 * （典型症状：新增后关掉、再点编辑，看到的是空表单）。所以这里主动回填一次。
 * 详情首次加载时 detailData 还是 undefined，由下面那个 watch 在到达后补上。
 */
watch(
  () => props.show,
  (show) => {
    if (!show) return
    formRef.value?.restoreValidation()
    if (!isEdit.value) {
      fillEmpty()
    } else if (detailData.value) {
      fillFromDetail(detailData.value)
    }
  },
  { immediate: true },
)

/** 详情到达（或切换到另一个书源）时回填 */
watch(detailData, (detail) => {
  if (!detail || !isEdit.value) return
  fillFromDetail(detail)
})

function handleClose() {
  emits('update:show', false)
}

function handleReset() {
  if (isEdit.value) {
    // 编辑态重置回「库里的值」，而不是清空——清空再提交等于把配置删了
    if (detailData.value) fillFromDetail(detailData.value)
  } else {
    fillEmpty()
  }
  formRef.value?.restoreValidation()
}

async function handleSubmitClick() {
  try {
    await formRef.value?.validate()
  } catch {
    // 校验失败时 naive-ui 已在表单项下给出提示，不重复弹消息
    return
  }

  // JSON 不过关就不发请求：让后端去报 500 会把「前端填错了」变成「服务器异常」
  if (configError.value) {
    message.error('配置 JSON 格式有误，请先修正')
    return
  }

  try {
    if (isEdit.value && props.sourceId != null) {
      await replaceSource({ id: props.sourceId, data: toPayload() })
      message.success('已保存')
    } else {
      await createSource(toPayload())
      message.success('已创建')
    }
    emits('success')
  } catch (error) {
    // 地址重复（409）这类业务错误必须展示出来
    message.error(getErrorMessage(error))
  }
}
</script>

<template>
  <NConfigProvider :theme-overrides="overlayThemeOverrides">
    <NDrawer
      :show="show"
      placement="right"
      :width="680"
      @update:show="handleClose"
    >
      <NDrawerContent
        :title="isEdit ? '编辑书源' : '新增书源'"
        :native-scrollbar="false"
        closable
      >
        <NSpin :show="detailLoading">
          <NForm
            ref="formRef"
            :model="formModel"
            :rules="rules"
            label-placement="left"
            label-width="96px"
          >
            <NDivider
              title-placement="left"
              class="!mt-0"
            >
              基本信息
            </NDivider>

            <NFormItem
              label="书源名称"
              path="name"
            >
              <NInput
                v-model:value="name"
                placeholder="必填，如「七步阁」"
                clearable
              />
            </NFormItem>
            <NFormItem
              label="站点地址"
              path="url"
            >
              <div class="flex w-full flex-col gap-y-2">
                <div class="flex items-center gap-x-2">
                  <NInput
                    v-model:value="url"
                    placeholder="必填，站点根地址，如 https://www.qibuge.com"
                    clearable
                    class="flex-1"
                  />
                  <NButton
                    secondary
                    type="info"
                    :loading="probing"
                    :disabled="probing || !url.trim()"
                    @click="handleProbe"
                  >
                    检测站点
                  </NButton>
                </div>
                <!-- 检测结果只对当前地址负责，改了地址会被 useUrlProbe 里的 watch 清掉 -->
                <SourceProbeAlert
                  v-if="probeResult"
                  :result="probeResult"
                  :url="url"
                />
                <!-- 编码没有输入框，所以这里得说清它从哪来。
                     编辑态还要把「现在用的是什么编码」露出来，否则用户改地址后编码被重置都无从察觉 -->
                <span
                  v-else
                  class="text-xs opacity-50"
                >
                  <template v-if="isEdit && charset !== 'utf-8'">
                    当前编码 {{ charset }}（点「检测站点」可重新识别）
                  </template>
                  <template v-else>
                    GBK 站点请先点「检测站点」，编码会自动识别并保存
                  </template>
                </span>
              </div>
            </NFormItem>
            <NFormItem label="启用">
              <div class="flex items-center gap-x-3">
                <NSwitch v-model:value="enabled" />
                <span class="text-xs opacity-60">停用后采集任务会跳过这个书源</span>
              </div>
            </NFormItem>
            <NFormItem label="启用探索">
              <div class="flex items-center gap-x-3">
                <NSwitch v-model:value="enabledExplore" />
                <span class="text-xs opacity-60">探索（分类/榜单）抓取开关</span>
              </div>
            </NFormItem>

            <NFormItem
              label="备注"
              path="comment"
            >
              <NInput
                v-model:value="comment"
                type="textarea"
                placeholder="选填，记录书源来源、用途等说明（最长 512 字符）"
                :autosize="{ minRows: 1, maxRows: 8 }"
                :maxlength="512"
                show-count
                clearable
              />
            </NFormItem>

            <NDivider title-placement="left">
              抓取与解析配置
            </NDivider>

            <NFormItem
              label="配置 JSON"
              label-placement="top"
              :feedback="configError"
              :validation-status="configError ? 'error' : undefined"
            >
              <NInput
                v-model:value="configJson"
                type="textarea"
                placeholder='{ "searchUrl": "https://example.com/search", "ruleSearch": { "bookList": "…" } }'
                :autosize="{ minRows: 16, maxRows: 30 }"
                class="font-mono text-xs"
              />
            </NFormItem>
            <div class="-mt-2 mb-2 flex flex-col gap-y-1 text-xs opacity-50">
              <span>
                可写 searchUrl / exploreUrl / header / jsLib，以及 ruleSearch、ruleBookInfo、
                ruleToc、ruleContent、ruleExplore 五组规则；未写的键视为不配置。
              </span>
              <span>header 也可写成键值对象，保存时自动转成字符串。</span>
              <span>名称、地址、开关、备注由上方表单维护，写在这里会被忽略。</span>
            </div>
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
              :disabled="submitting || detailLoading"
              @click="handleReset"
            >
              重置
            </NButton>
            <NButton
              type="success"
              :loading="submitting"
              :disabled="submitting || detailLoading || Boolean(configError)"
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
