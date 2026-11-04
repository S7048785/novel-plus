# 用户身份（角色）设计

> 决策日期：2026-11-05
> 范围：服务端（server 目录）的身份模型、接口鉴权改造、admin 控制台的菜单与用户管理

## 结论

- 身份是**能力集合**而不是等级，一个账号可以同时持有多个：`reader` / `author` / `admin`。
- 落库用关联表 `user_role`（复合主键 `(user_id, role)`），`user` 表不加 `role` 列。
- 权限分两层：**接口级**用 `@Roles()` 声明（守卫判 403），**数据级**（这本书是不是你的）在 service 里判。
- `reader` 是基础身份，所有账号都有；接口只接受 `author` / `admin`，`reader` 由服务端补齐。
- **目录即权限边界**：`src/admin/` 下的接口全挂 `/api/admin` 前缀且**只允许管理员**；
  作家端将来独立成 `src/author/` + `/api/author` 前缀，复用同一批 service。

## 三个身份能做什么

| 能力 | reader | author | admin |
|---|---|---|---|
| 登录 | ✓ | ✓ | ✓ |
| 进后台（admin 控制台） | ✗ | ✗ | ✓ |
| 管理端接口（`/api/admin/*`） | ✗ | ✗ | ✓ |
| 作家端接口（`/api/author/*`，**未实现**） | ✗ | 预留 | ✗ |
| 书源 / 采集（`/api/admin/crawl/*`） | ✗ | ✗ | ✓ |
| 用户管理（`/api/admin/users`） | ✗ | ✗ | ✓ |

**两道闸都只放管理员**（2026-11-05 收紧）：

1. 界面入口：前端路由守卫用 `canEnterAdmin`（等于 `isAdmin`）拦，非管理员登录后直接落 `/403`。
2. 数据入口：`src/admin/` 下每个 controller 都标了 `@Roles('admin')`，绕过界面直接打接口也是 403。

作家身份当前**没有任何可用接口**——`book.owner_id` 那套归属校验是为作家端预留的：
上线时新建 `src/author/` 模块、复用 `BookService` / `BookChapterService` 并传入真实 viewer，
`@Roles('admin','author')` 只出现在新模块上；`src/admin/` 始终保持只放管理员。

## 为什么是关联表而不是 user.role 一列

| 方案 | 好处 | 代价 |
|---|---|---|
| 单列 role | 实现最省事 | 一人不能同时是作家+管理员；要么存逗号串（不可索引、不可约束），要么逼人开两个账号 |
| 关联表（**采用**） | 天然支持多重身份；按身份筛选可走索引 | 每次鉴权多一次按主键的查询（成本可忽略） |
| better-auth admin 插件 | 自带封禁、设角色、模拟登录 | 端点挂在 `/api/auth/*`，OpenAPI 看不到、前端 codegen 生成不出来；还多 3 个用不上的列 |

## 鉴权链路

```
请求 → AuthGuard（全局）
  1. @Public()？            → 放行
  2. 有会话吗？              → 没有则 401
  3. 查 user_role 得到 viewer → 挂到 req.viewer
  4. @Roles(...) 满足吗？    → 不满足则 403
```

要点：

- **403 而不是 401**：前端对 401 的既定处理是清登录态跳登录页，非管理员访问受限接口被踢下线，比提示「没权限」糟糕得多。
- **身份不进会话**：`user_role` 是独立表，better-auth 的 session 拿不到；每次请求按主键查一次，换来「改身份下一个请求即生效」，不需要重新登录。
- **接口级 vs 数据级**：`@Roles('admin')` 只回答「能不能进这个接口」；「这本书是不是你写的」依赖数据，写在 `book-access.ts`（当前恒为管理员，作家端接入后才会生效）。

## 数据级隔离（书籍归属）

`book.owner_id`（`varchar(36)`，可空，无外键）：

| 取值 | 含义 | 谁可以改 |
|---|---|---|
| `null` | 系统书（采集入库、管理员建的公共书） | 只有管理员 |
| 某 user.id | 该作家名下的书 | 该书作者 + 管理员 |

规则：

- 列表的归属过滤**下沉到 SQL**，否则分页的 `total` 会把别人的书算进去。
- 作家建书自动归自己；想指定给别人 → 403（只有管理员能指派）。
- 归属转移只有管理员能发起；PUT/PATCH 里「不传 ownerId」表示**不改**，不用 PUT 的「不传即置空」语义——一次普通元数据保存顺手把书变成系统书，后果是它从作家后台消失，比少传字段更难排查。

## 防锁死三件套

1. **不能改自己的身份**（400）：管理员把自己降成读者，下一个请求就进不去后台。
2. **不能删自己**（400），包括批量删除里带上自己。
3. **不能移除最后一个管理员**（400）——这条目前是第二道防线：因为 1、2 已经堵死了唯一路径，它只在将来放开自我降级时才会真正生效。

命令行兜底（真被锁死时用）：

```bash
npm run user:set-role -- --email admin@example.com            # 查看
npm run user:set-role -- --email admin@example.com --roles admin
npm run user:set-role -- --email someone@example.com --add author
```

## 身份筛选的语义（容易误解，单独说明）

`GET /api/admin/users?role=`：

| 取值 | 含义 |
|---|---|
| `author` / `admin` | 持有该身份（多重身份者也算） |
| `reader` | **只**有读者身份（不含作家、管理员） |

reader 反着定义是因为它是所有账号的基础身份：按「持有」筛选等于返回全部，没有意义；真正有用的是「找出还没被授予附加身份的账号」。界面上对应的文案是「仅读者 / 含作家 / 含管理员」。

## 接口契约变更

| 接口 | 变化 |
|---|---|
| `GET /api/user/me` | 返回 `{ user, roles }`，未登录 `{ user: null, roles: [] }` |
| `GET /api/admin/users` | 响应加 `roles`；query 加 `role` 筛选 |
| `POST /api/admin/users` | body 加 `roles`（只接受 author/admin） |
| `PATCH /api/admin/users/:id` | body 加 `roles`（整体替换） |
| 全部后台接口 | 默认要求登录；用户管理/采集限 admin，书与章节限 admin+author |

## 前端配套

- `stores/user.ts` 持有 `roles`，派生 `isAdmin` / `isAuthor` / `canEnterAdmin`（当前等价于 `isAdmin`）。
- 菜单项 `meta.roles` + `filterMenuByRoles` 裁剪；路由守卫对 `meta.roles` 再校验一次（防手输 URL）。
- **非管理员（读者 / 作家）登录后直接落到 `/403`**，不进 layout——否则会看到空菜单。
- 身份缓存在 localStorage，管理员改身份后对方要刷新页面菜单才变；接口权限是即时生效的，最差表现是「菜单还在、点了 403」。

## 未做 / 后续

- 作家端整体未实现（前端页面 + 后端 `src/author/` 模块 + `/api/author` 前缀）：作家目前没有任何可用接口。
  接入时复用 `BookService` / `BookChapterService` 并传真实 viewer，同时在 `src/author/` 里声明 `@Roles('admin','author')`；
  `src/admin/` 不动，也不用改 `canEnterAdmin`（作家进的是作家端，不是后台）。
- 读者侧（书架、评论、阅读进度）在另一个前端（Java 的 novel-plus），本仓库不涉及。
- 采集入库的书 `owner_id` 为 null；把系统书派给某位作家需要管理员在后台手动改归属（当前没有批量指派 UI，接口已支持）。
