# 工作日志 · novel-nest

## 2026-11-02

采集模块从零落地。

- 按 reader-rust 方案实现规则引擎与采集编排（CSS / XPath / JSONPath / 正则 / JS 五种解析模式），8 个里程碑全部跑通
- 抽出 Repository 数据层；`crawl_source` 改为 json 全包 + `status` 运行状态字段
- CrawlService 支持 POST 搜索（含 GBK 站点编码处理）、正文多页拼接
- 目录重构为 `src/admin/`，公用代码收进 `src/common/`，db 层合并
- 补齐三套 CRUD：书源、书籍、章节；新增详情解析接口
- 接入第三个书源 bqquge.org
- 踩坑：quickjs-emscripten 句柄生命周期、tsx 下的 DI 不生效、nest 增量构建不产出新文件

## 2026-11-03

上午：版本管理 + 鉴权
- 初始化 git 仓库，首批提交拆成「项目导入」和「better-auth 邮箱密码登录」两个，推到 GitHub
- 鉴权只开邮箱密码登录、关闭注册，用户由脚本创建；auth 复用现有 DB 连接池

下午：规则引擎体检与修复
- 用真实站点写探针逐条验证语法覆盖，产出一份能力清单（哪些能用、哪些是死配置）
- 修复 parser：中间位置索引、`-` 倒序、字段级 `||` 兜底、`&&`/`||`/`%%` 优先级、单字段错误隔离、文档根节点改用 `$.root()`（og 元信息在 head 里原本一律取不到）、JSONPath 递归展开、删死代码

傍晚：书源扩张 + schema 精简
- 新增 xsbook 书源；为此补 HTTP 层能力：Cookie 罐、403 二次验证自动重发、URL 内联请求选项、采集间隔读 .env
- 修掉一个会崩进程的 bug：JS 沙箱异步回调晚于上下文销毁落地，触发 QuickJS assert
- schema 精简：删 `book_chapter.is_vip/is_pay`，删两条业务表外键（级联删除改为应用层事务）
- 新增 biqubee 书源，顺带补上目录多页抓取能力

深夜：书源探测
- biquga：完整目录页是软 404（返回另一本书），只能采前 100 章 —— 放弃
- youjiuxs：站点没有搜索功能（搜索框跳广告站），只能靠 8 个分类页；详情/目录/正文已验证可用，整本采集 66 章 25.9 万字通过

## 未提交 / 待办

- explore（分类浏览）仍未实现，youjiuxs 目前只能按已知 URL 采集；bqquge 的 exploreUrl 也在等这个能力
- 搜索结果的 `lastChapter` / `updateTime` 解析后仍被丢弃
- 远端（GitHub）还停在 `eb98a95`，11-03 之后的提交尚未推送

## 提交记录

| 提交 | 内容 |
|---|---|
| 762348f | 规则引擎：索引/倒序/兜底/优先级/容错 |
| c9bf981 | HTTP 层：Cookie 会话与 403 二次验证 |
| c283c0e | 新增 xsbook 书源 |
| 8d2a140 | schema：移除 VIP 字段与业务表外键 |
| ca4f217 | 目录支持多页抓取 |
| e161125 | 新增 biqubee 与 youjiuxs 书源 |
