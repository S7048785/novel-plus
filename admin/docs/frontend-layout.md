# 前端目录约定

2026-11-06 起，业务代码按**模块**收进 `src/features/`，`src/views/` 只留路由入口。

## 三层职责

```
src/
├── views/                     # 只放路由入口，每个路由目录一个 index.vue
│   ├── book/index.vue
│   └── user/index.vue
├── features/                  # 模块自己的东西都在这
│   ├── book/
│   │   ├── constants.ts       # 模块专属常量（标签配色、筛选项、表格宽度）
│   │   ├── queries.ts         # 所有 useQuery / useMutation 与 query key
│   │   ├── composables/       # 状态与动作（useBookQuery / useBookSelection）
│   │   ├── components/        # 工具栏、表格、弹窗（无状态，靠 props/emit 通信）
│   │   ├── pages/             # 模块自己的**路由页面**（非 index 的那种）
│   │   └── *.test.ts          # 模块测试跟着模块走
│   └── user/                  # 与 book 同构
├── constants/                 # 跨模块常量（目前只有分页候选）
├── api/                       # 接口函数 + 从 shared 派生的类型（与模块无关的薄层）
├── components/ composables/   # 跨模块复用的通用件
└── router/ stores/ utils/ ...
```

判断标准很简单：**只有这个模块会用到 → `features/<模块>/`；两个以上模块要用 → 往上提到 `src/components` / `src/composables`**。

`views` 里之所以能只剩 `index.vue`：路由入口通常就是「列表页/首页」，其余页面（如章节管理）是模块深链，放 `features/<模块>/pages/` 更合理。

## 路由怎么找到 features 里的页面

`router/helper.ts` 的 `resolveRoute` 扫描两处：

```ts
const modules = import.meta.glob(['@/views/**/*.vue', '@/features/**/pages/**/*.vue'])
```

菜单里的 `component` 字段**不用关心文件在哪**，按 `模块/页面` 写即可，解析顺序是：

1. `/src/views/<component>.vue`
2. `/src/features/<第一段>/pages/<其余段>.vue`

例如 `component: 'book/ChapterManage'` → `views/book/ChapterManage.vue` 不存在 → 命中 `features/book/pages/ChapterManage.vue`。

> 验证办法：`pnpm --filter admin build` 后看产物里有没有该页面的 chunk。glob 匹配不到的文件不会被打包，但构建**不会报错**——这是个静默失败点。

## `queries.ts` 的写法

项目用的是 **@pinia/colada**（TanStack Query 的 Pinia 版，API 同构但不是同一个包）。所有数据访问都收在 `features/<模块>/queries.ts`，组件里不再直接写 `useQuery`。

```ts
// 1) key 集中定义：缓存与失效完全由 key 决定
export const bookKeys = {
  listAll: [BOOK_LIST] as const,
  list: (query) => [BOOK_LIST, query.page, query.pageSize, query.keyword ?? '', query.origin ?? null] as const,
  detail: (id) => [BOOK_DETAIL, id] as const,
}

// 2) 读：参数传 getter，key 与请求参数同源
export function useBookList(query: () => AdminBookQuery) {
  return useQuery({ key: () => bookKeys.list(query()), query: () => getAdminBooks(query()), staleTime: 0 })
}

// 3) 写：失效在数据层，提示在组件层
export function useDeleteBook(callbacks: MutationCallbacks<DeleteResponse> = {}) {
  const cache = useQueryCache()
  return useMutation({
    mutation: deleteAdminBook,
    onSuccess: (data) => {
      cache.invalidateQueries({ key: [...bookKeys.listAll] })  // 前缀匹配，所有分页/筛选一起失效
      callbacks.onSuccess?.(data)
    },
    onError: (error) => callbacks.onError?.(error),
  })
}
```

三条硬规矩：

1. **key 与请求参数必须来自同一份值**（组件里用 `computed<XxxQuery>` 构造，再 `useBookList(() => listQuery.value)`）。否则分页一变就可能出现「key 是新的、请求还是旧的」。
2. **删除/更新后用 `invalidateQueries` 而不是 `refetch()`**。`refetch` 只重取当前 key，`invalidateQueries({ key: ['adminBooks'] })` 会让这一组所有分页/筛选的缓存一起过期，当前激活的自动重取。需要「强制重取当前页」时（如点查询按钮但条件没变）才用 `refetch`。
3. **提示语不进数据层**。`message.success('已删除')` 属于 UI，通过 `MutationCallbacks` 从组件传进去；数据层只负责「哪些缓存该过期」。

## 页面怎么继续往下拆（书籍列表是样板）

`views/book/index.vue` 从 482 行降到 174 行，只做编排。拆法是按**「谁持有状态」**切的，不是按视觉区块切的：

| 文件 | 持有什么 | 不做什么 |
|---|---|---|
| `constants.ts` | 标签配色、筛选项、表格宽度 | 任何随状态变化的值 |
| `composables/useBookQuery.ts` | 关键字（两份）、筛选、分页、列表请求与 `refetch` | DOM、消息提示 |
| `composables/useBookSelection.ts` | 选中行、两个删除 mutation、按钮禁用态 | 表格渲染 |
| `components/BookTable.vue` | 无状态，列定义 + `checked-row-keys` 双向 + 三个事件 | 跳转、弹窗、删除调用 |
| `src/components/ListQueryBar.vue` | 无状态，跨模块共用（见下） | 页码归 1 之类的业务规则 |

四条经验：

1. **业务规则跟着状态走，不跟着组件走。** 「切筛选回第一页」放在 `useBookQuery` 的 `watch(originFilter)` 里，而不是让查询条抛一个 `change` 事件再让页面处理——这样重置、将来的 URL 回填都能自动生效。
2. **两份 keyword 必须保留。** `keywordInput`（用户正在打的）和 `keyword`（生效的）分开，提交时机是「点查询 / 回车」。合并成一个就会出现边打字边请求。
3. **`unchanged` 才 refetch。** 条件变了靠 key 变化自动请求，再 refetch 会一次点击发两个请求。三个条件：关键字相同、页码已在 1（`handleReset` 还要加筛选项为空）。
4. **表格的 `scroll-x` 与列宽耦合。** 有 `fixed: 'right'` 的操作列时，`scroll-x` 必须 ≥ 所有列宽之和，否则 naive-ui 不启用横向滚动、列被压扁换行。写死在 `constants.ts` 的 `TABLE_SCROLL_X`，改列宽时同步。

### 查询条是共用的：`src/components/ListQueryBar.vue`

书籍页和用户页的查询条只有 4 个参数不同（placeholder、输入框宽度、下拉选项、下拉的 title），所以合成了一个泛型组件：

```vue
<ListQueryBar
  v-model:keyword="keywordInput"
  v-model:filter="originFilter"
  :options="ORIGIN_FILTER_OPTIONS"
  placeholder="书名或作者"
  filter-placeholder="全部来源"
  :loading="isLoading"
  :disabled="mergedLoading"
  @query="handleQuery"
  @reset="handleReset"
/>
```

`<script setup generic="T extends string | number">` 让 `options[].value` 与 `v-model:filter` 保持同一值域——如果写死 `string | number`，父级的 `BookOrigin | null` 就接不住组件抛回的值。下拉的 model 叫 `filter` 而不是 `origin` / `role`，因为各模块的筛选语义不同（入库方式 / 身份），名字必须中性。

组件只做「值上抛 + 通知父级」：**重置不自己清值**，清空是 `useXxxQuery.handleReset` 的职责；`disabled` 只禁用查询按钮、不禁用重置（用户要能在请求进行中清条件）。

`views/user/index.vue` 是同一套拆法的第二个样板（456 → 168 行），差异只有两处值得记住：

- **id 类型不同**。书籍 id 是 `number`，用户 id 是 better-auth 的 32 位字符串。批量删除时 `useBookSelection` 用 `Number(key)`、`useUserSelection` 用 `String(key)`——抄错会得到 `[NaN, NaN]`，后端静默删 0 行，不报错。
- **「不能操作自己」是表格的事**。`UserTable` 收一个 `selfId` prop（不在组件里读 store），据此禁用自己那行的删除按钮、并在身份列标「我」。测试因此可以直接给 id。

### 常量放哪

| 位置 | 放什么 | 例子 |
|---|---|---|
| `src/constants/` | 两个以上模块都要用 | `PAGE_SIZES`、`DEFAULT_PAGE_SIZE` |
| `features/<模块>/constants.ts` | 只有这个模块用 | `ORIGIN_TAG_TYPE`、`ROLE_FILTER_OPTIONS`、`TABLE_SCROLL_X` |

分页候选一开始写在 `features/book/constants.ts`，拆 user 时才发现两边都要——现在归 `src/constants/pagination.ts`。**先放模块内，出现第二个使用者再上提**，别一上来就建大而全的 `src/constants`。

## 测试怎么分层

| 层 | 测什么 | 例子 |
|---|---|---|
| composable | 状态迁移与请求参数 | `useBookQuery.test.ts`：key 与参数同源、页码归 1、unchanged 才 refetch |
| 组件 | props / emit / 关键 DOM 属性 | `BookTable.test.ts`：`scroll-x`、固定列、`update:checkedRowKeys` 双向、操作列事件 |
| 页面 | 冒烟：能渲染、能打开弹窗 | `index.test.ts` |

```bash
pnpm --filter admin exec vitest run src/features/book   # 只跑一个模块
```

> 踩坑：`@pinia/colada` 调用 mutation 函数时**会传第二个参数**（mutation context，含 entry/state）。
> 断言写 `toHaveBeenCalledWith([1, 2])` 会失败，要用 `toHaveBeenCalledWith([1, 2], expect.anything())`。
>
> 另一个：表格内部挂了 `ResizeObserver`，测试挂载后不卸载会在 jsdom 销毁时抛
> `global.removeEventListener is not a function`（不影响结果，但会污染输出）。
> 组件测试文件顶部加一行 `enableAutoUnmount(afterEach)` 即可。

## 什么不在这一层

- **表单提交**（`BookFormModal` / `UserFormModal` / `ChapterFormModal`）仍是组件内 `await createXxx(...)`：要先过 naive-ui 校验再提交，套 mutation 只是多一层包装。等出现乐观更新或统一重试的需求再迁。
- **查询参数类型**（`AdminBookQuery` 等）保持手写，不复用后端的 query schema——后者是「URL 字符串 → 值」的适配层（`z.coerce` / `.default` / `'true'→boolean`），前端手里已经是强类型。

## 遗留

`views/` 下还有几处非 `index.vue` 的文件，都属于模板自带页面，不属于业务模块，本轮没动：

| 位置 | 说明 |
|---|---|
| `views/data-show/**`（`ActionModal.vue` 等） | lithe-admin 的演示页。后端**没有** data-table / data-form 路由，是死代码，建议整块删而不是搬 |
| `views/sign-in/component/Illustration*.vue` | 登录页插画与配色弹窗。登录流程只有一个 `useMutation(userSignIn)`（包的是 store 的 action，不是 API 封装），搬进 `features/auth` 收益很低 |
| `views/feedback/discreteApi.ts` | 演示页的附属脚本 |
