<script setup lang="ts">
import { NButton } from 'naive-ui'

import { useUserStore } from '@/stores'

import ErrorPage from './index.vue'

/**
 * 403：登录了，但进不了后台。
 *
 * 后台只对管理员开放。这里按身份给出不同的解释，而不是一句笼统的「没有权限」：
 * - 作家：身份是有效的，只是后台还没给作家开入口（作家端未上线），说明这一点可以避免他去反复问；
 * - 读者：需要管理员授予身份，指引他找谁。
 *
 * 与 404 分开的理由：能登录说明账号没问题，丢一个「页面不存在」只会让人以为系统坏了。
 */
defineOptions({
  name: 'Forbidden',
})

// 这里需要的是 cleanup() 这个 action，storeToRefs 只给 state，所以直接用 store 实例
const userStore = useUserStore()
</script>

<template>
  <div class="flex h-dvh w-full items-center justify-center p-4">
    <ErrorPage
      :code="403"
      content="Forbidden"
      :container-style="{ maxWidth: '500px' }"
    >
      <div class="flex flex-col items-center gap-y-3">
        <p class="text-center text-sm opacity-80">
          当前账号<template v-if="userStore.user?.email">
            （{{ userStore.user.email }}）</template
          >无法进入后台。
        </p>
        <p class="text-center text-sm opacity-60">
          <template v-if="userStore.isAuthor">
            后台仅限「管理员」登录。你的「作家」身份可以调用书籍接口，但作家端还没有开放。
          </template>
          <template v-else> 后台仅限「管理员」登录，请联系管理员授予身份。 </template>
        </p>
        <NButton
          type="info"
          size="large"
          @click="userStore.cleanup()"
        >
          退出登录
        </NButton>
      </div>
    </ErrorPage>
  </div>
</template>
