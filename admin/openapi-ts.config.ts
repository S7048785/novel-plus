import { defineConfig } from '@hey-api/openapi-ts'
import { config } from '@novel-plus/shared'

/**
 * OpenAPI → TypeScript 请求代码生成配置。
 *
 * 后端（server 目录）把规范暴露在 `http://localhost:<config.ports.server>/openapi.json`
 * （Swagger UI 在 /docs）。端口来自 packages/shared，这里不写死。
 * 生成前先把后端跑起来（根目录 `pnpm openapi` 会先替你探测）。想指向别的地址就设 OPENAPI_URL。
 *
 * 产物目录 src/api/generated 整体由工具生成，不要手改——下次生成会被覆盖。
 * 需要定制客户端行为（baseURL / cookie / 超时）请改 src/api/hey-api.ts（见 runtimeConfigPath）。
 */
export default defineConfig({
  input: process.env.OPENAPI_URL ?? `http://localhost:${config.ports.server}/openapi.json`,
  output: {
    path: 'src/api/generated',
    /**
     * 不再配置 postProcess: ['prettier']：项目已移除 prettier，
     * 生成器会按自己的默认写法输出。src/api/generated 是纯产物，排版不影响使用，
     * 也不要在里面手改格式（下次生成会被覆盖）。
     */
  },
  plugins: [
    // 类型（每个接口的 path/query/body/response 都有类型）
    '@hey-api/typescript',
    // SDK：按 operationId 生成函数，例如 bookList / bookCreate
    '@hey-api/sdk',
    // axios 客户端（项目本来就用 axios，能直接复用拦截器）
    {
      name: '@hey-api/client-axios',
      runtimeConfigPath: './src/api/hey-api.ts',
    },
  ],
})
