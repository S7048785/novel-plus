# Monorepo 化设计（pnpm workspace）

> 决策日期：2026-11-06
> 范围：仓库结构（`admin` 管理端 + `server` 后端 + 将来的 `packages/*`）。不涉及任何业务功能改动。

## 结论

- 采用 **pnpm workspace 轻量方案**：一个锁文件、一套命令，**不引入 turbo / nx**。
- 进 workspace 的包只有两个：`admin`、`server`；`novel-plus/`（490MB 老 Java 项目）**排除在外**。
- 唯一有破坏性的动作是 **server 从 npm 迁到 pnpm**；四项验证（type-check / build / test / test:e2e）全绿才算迁移成功。
- 收益按优先级排：**统一包管理器 > 根脚本编排 > 共享契约常量**。第三项（`packages/shared`）的包基建与「两端端口」已在 2026-11-06 落地，`BOOK_ORIGINS` 等常量待迁；codegen 仍是可选后续。

## 执行状态（2026-11-06）

步骤 1~4 全部落地；步骤 5 的包基建 + 两端端口已落地（`BOOK_ORIGINS` 待迁）；步骤 6（codegen）仍是可选后续。

| 验收项 | 结果 |
|---|---|
| `pnpm install` | 826 个包，43s（store 已预热），SWC / esbuild 的 postinstall 正常执行 |
| `pnpm -r type-check` | 通过：`packages/shared` + `server` + `admin` 三包 |
| `pnpm -r build` | 通过：server `nest build`、admin `vite build` |
| `pnpm -r test` | 通过：server 54 用例 + admin 15 用例 |
| `pnpm --filter server test:e2e` | 通过：5 用例（连本地 MySQL） |
| `pnpm dev` | 双端并行：SWC 编译 69 文件 455ms，vite 在 5799 |
| `pnpm openapi` | 后端在跑：探测 19 个 path → 生成 24KB 产物；后端未跑：明确报错退出 1，不动文件 |
| 端口收口 | 把共享包里的端口临时改成 `3123 / 5821`：后端 listen、vite dev server、vite 代理目标、`openapi` 探测**四处全部跟随**（且不需要重新构建任何包）；改回 `3000 / 5799` 后回归四绿 |

### 实施中暴露的两个真问题

1. **幽灵依赖 `domhandler`**：`server/src/admin/crawl/parser/{html,rule-engine,content-cleaner}.ts` 从 `domhandler` 做 `import type`，但 `server/package.json` 从来没声明它——以前靠 npm 的扁平结构从 `cheerio` 那里"蹭"到了。pnpm 隔离结构下 `tsc` 立刻报 `TS2307`。已按 cheerio 的范围补进 `dependencies`（`^5.0.3`）。**这正是迁 pnpm 想要的收益，不是麻烦**。
2. **pnpm 11 的构建脚本必须逐个表态**：`pnpm install` 会以 `ERR_PNPM_IGNORED_BUILDS` 直接失败（不是警告），并且自动往 `pnpm-workspace.yaml` 写一段 `allowBuilds` 占位。落到配置里的是：`@swc/core: true`、`esbuild: true`（要二进制），`@scarf/scarf: false`（纯统计上报，本机不必跑）。

### 计划外的必要改动

| 改动 | 原因 |
|---|---|
| 根 `.npmrc` 承接 `engine-strict=true`，删掉 `admin/.npmrc` | workspace 的安装配置只读根 `.npmrc`，子包那份不再生效；留两份只会误导 |
| `server` 加 `dev` 脚本（= `nest start --watch`） | 根 `dev` 走 `pnpm -r --parallel dev`，需要每个包都有同名脚本 |
| `admin` 加 `test` 脚本（`vitest run`），`test:unit` 保留为 watch | 根 `test` 走 `pnpm -r test`；`test:unit` 是 watch 模式，不能进 CI 口径 |
| 根 `.gitignore` 补 `/node_modules/` | 根目录原来没忽略它，pnpm 虚拟 store 会以未跟踪状态出现在 `git status` 里 |
| `admin/.gitignore` 的 `,env.production` 修正为 `.env.production` | 原有笔误（开头是逗号），导致该文件从未被忽略 |
| 删掉 `admin/pnpm-lock.yaml`（未入库）、`server/package-lock.json`（已入库，可从历史恢复） | 全仓库只留根 `pnpm-lock.yaml` |


## 现状盘点（2026-11-06）

| 目录 | 作用 | 包管理器 | 锁文件 | 体积（含 node_modules） |
|---|---|---|---|---|
| `admin/` | Vue 3 + naive-ui 管理端 | pnpm 11.9.0 | `pnpm-lock.yaml` | 421MB |
| `server/` | Nest 12 + drizzle + SWC | npm | `package-lock.json` | 352MB |
| `novel-plus/` | 老 Java 项目（novel-admin / common / crawl / front） | 无 | 无 | 490MB |
| 仓库根 | **无 `package.json`、无 workspace 配置、无根脚本** | — | — | — |

运行时：Node `22.22.2`、pnpm `11.9.0`。当前仓库**没有 CI 配置、没有 Dockerfile**。

> 补记一处当时的误判：两边锁文件的入库状态其实是**反的**——`server/package-lock.json` 被 git 跟踪，而 `admin/pnpm-lock.yaml` 被 `admin/.gitignore` 忽略、从未入库。也就是说迁移前仓库里只有一份"过期风险更高"的 npm 锁文件在版本控制下。迁移后根 `pnpm-lock.yaml` 必须入库，否则整个统一包管理器的收益会缩水成"只是换了命令"。

### 已经发生的三个具体问题

1. **包管理器混用事故（2026-11-05）**：在 server 目录执行 `pnpm start:dev`，pnpm 的运行前依赖校验发现 node_modules 是 npm 装的，开始把包搬进 `node_modules/.ignored` 试图重装，中途 `EPERM` 失败，`node_modules` 变成半搬移状态，靠 `npm install` 才复原。两个项目各用一套包管理器，这类事故会反复出现。
2. **跨端动作只能手工三步**：OpenAPI 生成链要求「先起后端 → 再跑 `pnpm openapi` → 前端使用产物」，三步分散在两个目录、两套命令里，漏一步就得到一份过期或空产物。
3. **契约常量存在双份**：`BOOK_ORIGINS` / `BOOK_ORIGIN_LABELS` 在 `server/src/common/book/origin.ts` 与 `admin/src/api/adminBook.ts` 各写一份，只能靠人保证一致。

## 方案对比

| 方案 | 收益 | 代价 | 判断 |
|---|---|---|---|
| 保持现状（两个独立包） | 零成本 | 上述三个问题全部保留 | ✗ |
| 拆成两个 git 仓库 | 边界清晰 | 跨端原子提交丢失；共享契约更难做 | ✗ |
| **pnpm workspace** | 统一包管理器、根脚本、可共享 | server 需迁移一次 | **✓ 采用** |
| pnpm workspace + turbo/nx | 任务缓存、任务图 | 两个包的任务图收益抵不过配置与缓存调试成本 | 暂不采用 |

## 目标结构

```
novel-plus/
├── pnpm-workspace.yaml      # packages: admin, server, packages/*
├── package.json             # private，只放 scripts 与 packageManager，不放运行时依赖
├── pnpm-lock.yaml           # 全仓库唯一锁文件
├── admin/                   # 保持独立构建（vite）
├── server/                  # 保持独立构建（nest build + SWC）
├── packages/                # shared 契约常量（源码直出，不编译）
└── novel-plus/              # 老 Java 项目，不进 workspace
```

原则：**workspace 只负责「安装」与「脚本编排」，不改变任何子包的构建方式**。`admin` 仍然 `vite build`，`server` 仍然 `nest build`，部署产物形态不变。

## 迁移步骤

每一步都是独立提交、可单独回滚。

| # | 动作 | 验收 | 回滚 | 状态 |
|---|---|---|---|---|
| 1 | 根目录加 `pnpm-workspace.yaml` 与根 `package.json`（private、只放 scripts） | `pnpm -r exec pwd` 列出 admin、server；两边现有命令仍可用 | 删除两个文件 | ✅ |
| 2 | server 迁 pnpm：删 `package-lock.json` 与 `node_modules`，`pnpm install` | type-check / build / test / test:e2e 全绿；`start:dev` 正常（SWC 编译 <1s） | 恢复 `package-lock.json`（git 历史）+ `npm install` | ✅ |
| 3 | 根脚本：`dev`（并行双端）、`openapi`、`type-check`、`test` | 一条命令起双端；后端未启动时 `openapi` 报可读错误而非生成空文件 | 删除对应 script | ✅ |
| 4 | 文档与忽略规则同步 | 新环境按文档从零跑通 | 还原文档 | ✅ |
| 5 | `packages/shared` 抽共享常量 | 前后端不再各自定义同一份常量，build 全绿 | 移除引用，恢复各包内定义 | 端口已做；`BOOK_ORIGINS` 待做 |
| 6 | （可选）codegen 替换手写 API 层 | 生成产物与手写层无损替换 | 恢复手写 `adminBook.ts` / `adminChapter.ts` | 未做 |

### 落地后的目录

```
novel-plus/
├── package.json             # private，scripts + packageManager，无运行时依赖
├── pnpm-workspace.yaml      # packages + allowBuilds
├── pnpm-lock.yaml           # 唯一锁文件（已入库）
├── .npmrc                   # engine-strict（子包不再各自持有）
├── scripts/openapi.mjs      # openapi 闸门：探测 → 生成 → 校验
├── packages/shared/         # 零依赖共享包，源码直出（不编译）
├── admin/                   # 树内无 lock / .npmrc，端口不在这里
├── server/                  # 树内无 lock，dev 脚本 = nest start --watch
└── novel-plus/              # 老 Java 项目，仍在 .gitignore
```

## 端口收口：`packages/shared` 是唯一出处

```ts
// packages/shared/src/index.ts
export const config = {
  ports: { server: 3000, admin: 5799 },
} as const
```

改端口只改这一处。四个消费点都是 `import { config } from '@novel-plus/shared'`：

| 消费点 | 用途 |
|---|---|
| `server/src/config/ports.ts` | main.ts 的 `app.listen()`、better-auth 的 `baseURL` |
| `admin/vite.config.ts` | dev server 端口 + `/api` 代理目标 |
| `admin/openapi-ts.config.ts` | codegen 默认输入地址 |
| `scripts/openapi.mjs` | 闸门探测地址 |

**取值优先级：`PORT` 环境变量 > `config.ports.server`。** 部署时端口是环境决定的（容器映射、云平台注入），不该由仓库常量说了算；本地开发没设 `PORT` 才用常量。这个优先级只写在 `server/src/config/ports.ts` 一处。

**这个包源码直出，不编译**（`exports` 直接指向 `./src/index.ts`），所以没有构建步骤、没有 `dist`，改完不用 rebuild。代价是**运行时需要 Node ≥22.18**（原生类型擦除默认开启）：SWC 编出的 `dist/main.js` 里 `@novel-plus/shared` 是裸导入，由 Node 运行时解析到 `.ts` 源码并擦掉类型。已实测 `pnpm dev:server`、`scripts/openapi.mjs`、openapi-ts 配置都能加载；`admin` 侧由 vite 的 esbuild 统一打包，不受这条约束。

> 为什么不用一个 JSON 文件：JSON 要读文件 + 四处算相对路径，而且 `JSON.parse(...) as Ports` 是纯断言，写成 `"server": "3000"` 也照样放行。共享包能带注释、能被 tsc 检查、能 IDE 跳转，后面 `BOOK_ORIGINS` 那批常量也要放进来。
>
> 为什么不在服务端写 `import '../../../packages/shared/src/index.ts'`：`server/src` 是 tsc 的 `rootDir`，包外文件进编译单元会让 `dist` 里留下指向包外的路径，产物单独部署就断链。走 npm 包名的裸导入，路径交给 Node 解析，产物只依赖 `node_modules`。

**踩坑记录：`.env` 里的 `PORT` 会静默盖掉共享包的值。** `@nestjs/config` 在 `NestFactory.create` 阶段就把 `.env` 灌进 `process.env`，而 `app.listen()` 在那之后，所以 `server/.env` 写 `PORT=3000` 时改共享包完全没反应。已从 `server/.env` 删掉 `PORT` 与 `BETTER_AUTH_URL`（`server/.env` 不入库，新克隆没有这个问题）。另外 `main.ts` 现在会打一行 `[Bootstrap] HTTP 监听 http://localhost:3000`——Nest 默认不打印监听地址，排查端口来源时很费劲。


## 关键决策与理由

**为什么不用 turbo / nx**
只有两个包，且各自构建本来就快（server SWC 编译 0.6s、admin vite 秒级）。任务缓存的价值来自「包多 + 任务重」，当前都不成立；引入后要额外维护任务图与缓存目录，排障成本高于收益。真到包数 ≥5 或 CI 出现长构建再评估。

**为什么排除 `novel-plus/`**
它是原有 Java 项目源码（novel-admin / common / crawl / front），不是 pnpm 包，进 workspace 只会让 `pnpm -r` 扫到无关目录。它作为「参考实现 / 数据源格式来源」保留在仓库里。

**为什么把 server 迁到 pnpm，而不是反过来让 admin 用 npm**
admin 已经是 pnpm 且锁文件正常；server 迁一次是一次性成本，而反向迁移会丢掉 pnpm 的严格依赖解析（正是我们想要的「暴露幽灵依赖」能力）。同时统一到 pnpm 后可直接用 workspace 协议与 `packages/shared`。

**是否开 `shamefully-hoist`**
不开。pnpm 的严格结构会暴露「代码里 import 了但 package.json 没声明」的依赖——这不是麻烦，是收益，遇到就补声明。开启 hoist 等于把 npm 的扁平结构重新引入，失去迁移的意义。

**`packageManager` 字段**
根 `package.json` 固定 `"packageManager": "pnpm@11.9.0"`，配合 corepack 保证团队与将来的 CI 用同一版本，避免 pnpm 大版本行为差异（典型差异：`verify-deps-before-run` 的默认行为，正是 11-05 事故的触发点）。

**`openapi` 脚本的契约**
必须是「前置于生成的前置检查」：先探测后端规范地址（`config.ports.server`）可达，不可达则直接失败并提示「请先起后端」，**不要**在拿不到规范时生成空产物——一份空的 `types.gen.ts` 比没有更糟。
实现放在 `scripts/openapi.mjs`（零依赖，用 Node 内置 `fetch`）：探测 → 校验返回体确实是 OpenAPI（有 `openapi` 字段和 `paths`）→ 调 `pnpm --filter admin openapi` → 事后检查产物 ≥1KB。任一步不满足都以非 0 退出。写成脚本而不是 `&&` 串联，是因为「HTTP 200 但不是规范」和「产物被写成空文件」这两种情况 shell 判断不了。

**`allowBuilds` 逐个表态，而不是一律放行**
`pnpm-workspace.yaml` 里只放行真正需要跑 postinstall 的包（`@swc/core`、`esbuild`，都是装二进制），`@scarf/scarf` 这类统计上报脚本明确关掉。默认全放行等于把供应链里任意依赖的安装脚本都执行一遍。

**根 `dev` 用 `pnpm -r --parallel`，不用默认的拓扑序**
两个包之间没有依赖关系，拓扑序只会让它们排队启动。`--parallel` 让两边同时跑；输出带 `admin dev:` / `server dev:` 前缀，仍可分辨。没有选 `--aggregate-output`，因为 dev 是长驻进程，缓冲输出会让 HMR 日志失去实时性。

## 风险与缓解

| 风险 | 影响 | 缓解 | 判定标准 |
|---|---|---|---|
| pnpm 严格依赖暴露幽灵依赖 | server 构建失败 | 补 `package.json` 声明，不绕过、不开 hoist | build 通过 |
| 平台可选二进制（`@swc/core`、`vitest`、`drizzle-kit`）在 Windows 下异常 | 编译/测试跑不起来 | 干净重装验证；必要时显式声明 optionalDependencies | `start:dev` 与测试正常 |
| 迁移后忘记跑 e2e | 数据库相关用例静默失效 | 迁移验收必须包含 `test:e2e` | e2e 全绿 |
| 将来接 CI/容器仍按 npm 写 | 构建失败 | 当前无 CI/Dockerfile；接入时统一 pnpm + corepack，写入本文件 | 接入时补充 |
| `packages/shared` 引入循环依赖（server ↔ shared ↔ admin） | 构建报错 | shared 只放常量与类型，零运行时依赖，不 import 任何包 | `pnpm -r build` 通过 |
| shared 源码直出依赖 Node 原生类型擦除（≥22.18） | Node 20 / 22.12~22.17 上 `dev:server` 直接 `ERR_UNKNOWN_FILE_EXTENSION` | 三个包的 `engines` 都写死 `>=22.18.0`（Node 20 已于 2026-04 EOL）；真需要兼容老 Node 就把 shared 改成 `tsc` 出 `dist` | `node -v` 满足 engines，install 不报错 |
| pnpm 11 把未批准的构建脚本当**错误**（不是警告），`ERR_PNPM_IGNORED_BUILDS` 直接中断 install | 装不完，node_modules 处于半成品状态 | 在 `pnpm-workspace.yaml` 的 `allowBuilds` 里逐个表态；新增依赖带 postinstall 时会被这条错误提示到 | `pnpm install` 退出码 0 |
| 影子依赖（代码里 import、manifest 没声明） | `tsc` 报 `TS2307` | 补声明，不开 hoist 绕；新增依赖时先看是不是从别的包"蹭"来的 | `pnpm -r type-check` 通过 |

## 验收清单（命令级）

以下命令在 2026-11-06 已全部实测通过，可当作回归清单重复执行。

```bash
pnpm install                  # 根目录一次装齐
pnpm -r type-check            # 两个包的类型检查
pnpm -r test                  # 单测（server vitest run + admin vitest run）
pnpm -r build                 # 两个包各自构建（nest build / vite build）
pnpm --filter server test:e2e # 端到端（需要数据库）
pnpm dev                      # 并行起 server + admin
pnpm dev:server               # 只起后端（nest start --watch + SWC，端口 3000）
pnpm dev:admin                # 只起前端（vite，端口 5799）
pnpm openapi                  # 后端在跑时生成，不在跑时明确报错
```

单端起一侧的场景：只调后端 + 用 `pnpm openapi` 生成契约；或后端已在另一个终端跑着、只想重开前端。

> 踩坑记录：vite 端口被占时**不会失败**，会顺延到 5800、5801……一路往下找。所以 `dev:admin` 起来后别只看"启动成功"，要看它打印的实际端口；之前有残留的 vite 进程占着 5799~5818，结果新实例跑到 5819 上去了。

## 待确认

1. ~~`packageManager` 是否锁死 `pnpm@11.9.0`~~ → 已锁（根 `package.json` 的 `packageManager` 字段），配合 corepack 保证团队与 CI 同版本。
2. 第 5 步 `packages/shared` 的剩余部分：包基建 + 端口已经落地，`BOOK_ORIGINS` / `BOOK_ORIGIN_LABELS` 还各写两份，待迁。
3. 第 6 步 codegen 的前置：需要后端接口都有 `@ApiZodOk` / `@ApiZodCreated` 声明，否则生成出 `unknown`；缺声明的接口要先补齐注解。
4. 生成物与手写层并存：`pnpm openapi` 会整体重写 `admin/src/api/generated`。当前业务代码走手写层（`adminBook.ts` 等），生成的差异纯属噪声——所以本次改造**没有**把重新生成的产物一并提交，`admin/src/api/generated` 保持改造前状态。真要走 codegen（步骤 6）时再一次性切换并提交。

