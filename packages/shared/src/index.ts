/**
 * 前后端共享的常量与配置。
 *
 * 铁律：这个包**零运行时依赖**，不 import 任何第三方包，也不 import server / admin 里的东西。
 * 一旦反向依赖就形成 server → shared → server 的环，构建会直接报错。
 *
 * 为什么端口放这里：端口是唯一一处「前端和后端都必须知道同一个数」的配置。
 * 放各自项目里靠人同步（改后端忘了改前端代理，症状是接口 502，排查成本远高于一次 import）。
 */
export const config = {
  /**
   * 两端端口。改这里，四个消费点会一起跟着变：
   * server 的 app.listen、better-auth 的 baseURL、vite dev server + /api 代理目标、openapi 代码生成。
   *
   * 部署时后端端口用 `PORT` 环境变量覆盖（优先级更高）——端口在容器/云平台是环境决定的，
   * 不该由仓库里的常量说了算。详见 server/src/config/ports.ts。
   */
  ports: {
    /** 后端（Nest）监听端口 */
    server: 3000,
    /** 前端（vite dev server）监听端口 */
    admin: 5799,
  },
} as const;
