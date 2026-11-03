---
name: book-source-rule
description: 编写和验证小说书源规则（book source rule）。当用户提供一个小说网站 URL、要求"添加书源"、"写书源规则"、"适配某个小说站"，或需要分析站点 HTML 结构并产出 reader-rust 风格的书源 JSON（searchUrl/ruleSearch/ruleBookInfo/ruleToc/ruleContent）时，应使用本技能。覆盖 CSS/JSONPath/XPath/正则/JS 五种规则语法，以及 GBK 编码、懒加载图片、反爬陷阱、正文分页等常见坑。
agent_created: true
---

# 书源规则编写（Book Source Rule）

## 概述

为小说站点编写 reader-rust 风格的书源规则 JSON，产出可被规则引擎直接执行的 `searchUrl`、`ruleSearch`、`ruleBookInfo`、`ruleToc`、`ruleContent` 配置。核心方法论：**先抓站点、分析真实 HTML 结构，再写规则，最后用规则引擎逐字段验证**——绝不凭猜测写选择器。

## 何时使用

- 用户给出小说网站 URL（如 `https://www.qibuge.com`）要求"添加书源"或"写书源规则"
- 需要把阅读 3.0（legado）格式的旧规则转换成 reader-rust 格式
- 调试某个书源规则字段提取不到数据

## 核心工作流（必须按顺序）

### 第 1 步：抓取并识别编码

用 `curl` 或 `fetch` 抓首页，**先识别编码**再分析结构。判断方法：

```bash
# 看 <meta charset> 声明；若无声明，分别用 gbk 和 utf-8 解码，看哪个不是乱码
curl -s -A "Mozilla/5.0 Chrome/124" "https://站点/" | head -c 2000
```

关键点：GBK 站点 `TextDecoder('gbk')` 才能正确解出中文；UTF-8 站点反之。编码对不上，后续所有中文都是乱码，规则"看起来失效"其实是编码错。

### 第 2 步：分析各页面的真实 HTML 结构

逐页抓取并确认选择器，**不要照搬其他站点的规则**（两个笔趣阁类站结构可能处处不同）：

| 页面 | 要确认的结构 |
|---|---|
| 首页/分类页 | 列表容器、书名/作者/封面/链接的选择器 |
| 详情页 | 书名、作者、简介、封面、**目录是内嵌还是独立页** |
| 目录页 | 章节列表容器、章节名/链接的嵌套方向（`a>dd` 还是 `dd>a`） |
| 正文页 | 正文容器、是否分页、有无反爬干扰 |

用 `cheerio` 或直接 `indexOf` 定位关键 class/id，把 HTML 片段打印出来看嵌套关系。

### 第 3 步：写规则 JSON

按 reader-rust 规范写五个字段。语法细节见 `references/rule-syntax.md`。先写最保守的选择器，再逐步精确。

### 第 4 步：用规则引擎逐字段验证（关键）

写完后**必须实际跑一遍验证**，不能交付未验证的规则。用引擎的 `evalFieldOnDoc`（文档级字段）和 `extractListFromHtml`（列表字段）对抓到的真实 HTML 测试每个字段：

```ts
import { evalFieldOnDoc, extractListFromHtml } from './src/crawl/parser/rule-engine.ts';
// 详情页字段
const name = await evalFieldOnDoc('#info h1@text', detailHtml, ctx);
// 列表字段
const list = await extractListFromHtml('.item', { name: 'h3 a@text', bookUrl: 'h3 a@href' }, html, baseUrl);
```

## 常见陷阱（写规则时必须检查）

1. **编码**：GBK 站点关键词要 GBK 编码（`charset` 字段 + 引擎 `encodeKey`），正文/详情页也要按站点 `charset` 解码。
2. **懒加载图片**：封面可能不在 `src` 而在 `data-original`、`data-src`，取错属性图片全空。
3. **反爬陷阱链接**：目录列表末尾常埋隐藏的垃圾链接（如 `style="display:none"` 的 `bot_test.php`），需用 `:not([style])` 或 `text.` 过滤。
4. **表头行混入**：搜索结果列表第一行常是表头（"作品名称/作者/..."），靠"书名字段取到空 → 过滤"或更精确的选择器排除。
5. **正文分页**：长章节拆成 `-2`/`-3` 多页，需配 `nextContentUrl` 抓取拼接；最后一页的"下一页"会变成"下一章"，用 `text.下一页@href` 精确匹配"下一页"文本天然终止。
6. **作者前缀**：作者字段常带"作者："前缀，用 `##作者[：:]\s*` 正则去掉。
7. **`>` 子选择器**：规则引擎已支持标准 CSS（`div.ll > div.item`），但注意 legado 的 `class.xxx yyy` 多 class 写法与标准 CSS 的差异，优先写标准 CSS 选择器。

## 规则字段速查

完整语法和真实站点案例见 `references/rule-syntax.md`。核心字段：

- `searchUrl`：`/search?key={key}` 或 `/search,{method:POST,body:"keyboard={key}"}`（POST 表单）
- `ruleSearch` / `ruleExplore`：搜索/分类列表（bookList + 各字段选择器）
- `ruleBookInfo`：详情页字段（含 `tocUrl` 指向独立目录页）
- `ruleToc`：章节列表（chapterList + chapterName + chapterUrl）
- `ruleContent`：正文（content + 可选 `nextContentUrl` 分页 + `replaceRegex` 清洗）

## 资源

- `references/rule-syntax.md` — 完整规则语法（CSS/JSONPath/XPath/正则/JS）+ 三个真实站点案例
