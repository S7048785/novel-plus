# OpenAPI 契约 · 后端生成、前端 codegen

> 决策日期：2026-11-04
> 范围：novel-nest 的接口文档生成、lithe-admin 的请求代码生成

## 结论

- **后端只有一个契约来源**：controller 参数装饰器上的 zod schema（请求）+ handler 上的 `@ApiZodOk` / `@ApiZodCreated`（响应），由 `@nestjs/swagger` 汇成规范，暴露在 `/openapi.json`（UI 在 `/docs`）。
- **前端不手写接口类型**：用 `@hey-api/openapi-ts` 从该规范生成 `src/api/generated`，包含类型与 SDK 函数。
- 手写的 axios 封装（`src/utils/request.ts`）继续存在，只用于 better-auth 那几个 Swagger 看不到的端点（`/api/auth/*`）。

## 为什么不需要手写 DTO

Nest 12 的 Swagger 模块会读 Standard Schema 的 `~standard.jsonSchema` 扩展（zod 4.2+ 实现了它），把 `@Body({ schema })` / `@Query({ schema })` / `@Param({ schema })` 里的 zod schema 直接转成 OpenAPI 参数与请求体。

所以**请求侧零额外工作**：写 zod schema 的那一刻，校验和文档就同时有了，包含 `minLength`、`default`、`required` 这些细节。

## 响应侧为什么必须显式写

handler 的返回类型是 TS 类型，编译后不存在，Swagger 无法反射。不写的话接口文档里 200 响应是空的，前端生成出来的返回类型就是 `unknown`。

```ts
@Get()
@ApiZodOk(bookListResponseSchema)   // 响应结构来自 zod
list(@Query({ schema: listBookQuerySchema }) query: ListBookQuery) { ... }
```

`ApiZodOk` / `ApiZodCreated` 定义在 `src/common/dto/openapi.ts`，内部就是 `z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'output' })`。

响应 schema 放在各模块的 `*.response.schema.ts`，与 `*.payload.schema.ts`（入参）分文件——前者只描述文档，不参与运行时校验，混在一起容易误以为返回值也被校验。

## 路径前缀：/api

`main.ts` 里 `app.setGlobalPrefix('api')`，所有业务接口都在 `/api` 下，与 better-auth 的 `/api/auth/*` 同前缀。前端因此只需要一条 proxy 规则、一个 baseURL。

**代价**：`AuthController` 挂的是 `/api/user/me` 而不是 `/api/auth/me`。
原因不是命名偏好——`main.ts` 里 `expressApp.all('/api/auth/*splat', toNodeHandler(auth))` 在 `listen()` 之前就注册了，早于 Nest 把 controller 挂到 express 上，所以 `/api/auth/*` 下任何路径都先被 better-auth 接住。业务侧不要在该命名空间建接口。

## 前端生成流程

```bash
# 1. 先起后端（规范从运行中的服务拉取）
cd novel-nest && npm run start:dev

# 2. 生成
cd lithe-admin && pnpm openapi
```

- 输入地址默认 `http://localhost:3000/openapi.json`，可用环境变量 `OPENAPI_URL` 覆盖。
- 产物：`src/api/generated`（types / sdk / client），**不要手改**，下次生成会覆盖。
- 客户端行为（baseURL、withCredentials、超时）改 `src/api/hey-api.ts`，它通过 `runtimeConfigPath` 被生成代码引用。

## 约定与坑

1. **新增接口忘了写响应装饰器** → 该接口在前端生成出来的返回值是 `unknown`，不会报错但也没类型。这是最容易漏的一步。
2. **operationId 决定 SDK 函数名**。`main.ts` 里配成 `${controller 短名}_${方法名}`（如 `book_list` → `bookList`）。方法名别和 controller 名重复（`CrawlController` 里的 `crawlBook` 会生成 `crawlCrawlBook`），本仓库已把那个方法改名为 `book`。
3. **不要手写重复类型**。前端要某接口的返回类型，从 `@/api/generated` import，别再抄一份 interface。
4. **响应 schema 与 service 返回结构会漂移**。改了 service 返回字段，记得同步 `*.response.schema.ts`，否则前端类型是错的。

## 鉴权：403 INVALID_ORIGIN 与 trustedOrigins

better-auth 在 `/api/auth/*` 上有 CSRF 来源校验：它比对请求头里的 `Origin`（无 `Origin` 时退化为 `Referer`）是否在白名单内。不在就**直接 403 `{"message":"Invalid origin","code":"INVALID_ORIGIN"}`**，密码对错都轮不到。

白名单来源是 `BETTER_AUTH_TRUSTED_ORIGINS`（逗号分隔）。它**不包含** `baseURL`，`baseURL` 是另一个字段（`BETTER_AUTH_URL`）——代码里两者是分开拼的，所以留空 ≠ 信任自己，而是「只信任 `BETTER_AUTH_URL` 的 origin」。

开发期前端跑在 vite（`localhost:5799`），浏览器发出的 `Origin` 就是 `http://localhost:5799`，必须在白名单里：

```dotenv
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:5799,http://127.0.0.1:5799
```

排查时容易误判，因为 **curl 默认不发 `Origin` 头**：直接 curl 能登录成功，浏览器却 403。复现真实浏览器行为要手动加头：

```bash
curl -i -X POST http://localhost:5799/api/auth/sign-in/email \
  -H "Origin: http://localhost:5799" -H "Content-Type: application/json" \
  -d '{"email":"reader@example.com","password":"12345678"}'
```

配套要点：

- 改 `.env` 必须**重启后端**（`ConfigModule.forRoot` 只在启动时读一次，不热重载）。
- 用手机/局域网调试时 `vite server.host: true` 会让页面跑在 `http://192.168.x.x:5799`，`Origin` 也就变了，得把这个地址也加进白名单。
- 生产环境前端若与后端不同域（`VITE_SITE_BASE_API` 填了完整 origin），同样要把前端域名加进来。
- cookie 不区分端口，`localhost:5799` 与 `localhost:3000` 同域，所以开发期 dev server 代理下 `Set-Cookie` 能正常落地，无需额外配置 `domain`。
