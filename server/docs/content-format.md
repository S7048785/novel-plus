# 正文存储格式契约 · Markdown

> 决策日期：2026-11-04
> 适用范围：`book_content.content` 列、采集入库链路

## 结论

小说正文入库统一采用 **Markdown 段落格式**，在**采集层统一清洗**，而非依赖各书源规则。

- 一个段落 = 一行；
- 段落之间用一个空行（`\n\n`）分隔；
- 段落内部的换行/连续空白压成单个空格。

## 背景与问题

不同书源的 `ruleContent.content` 取值后缀不同：

- `@text` → 提取的是剥掉标签的纯文本；
- `@html` / `@all` → 提取的是带 `<p>` 的 HTML 片段。

若不在采集层统一，正文格式会跟着书源规则漂移（历史上 DB 里就出现过 HTML 与纯文本混合：七步阁是 HTML，笔趣阁因规则不同形态各异）。

## 为什么是 Markdown 而不是纯文本 / HTML / JSON

| 维度 | 纯文本 | Markdown | HTML | JSON |
|---|---|---|---|---|
| 三端渲染库（web/Flutter/小程序） | 需手写换行解析 | 现成（markdown-it / flutter_markdown / towxml） | flutter_html 性能一般 | 反模式 |
| 结构语义（标题/段落/引用） | 无 | 有 | 有 | — |
| XSS 风险 | 无 | 低（渲染层转义） | 需白名单过滤 | 无 |
| 存储体积 | 最小 | 小 | 偏大 | 大 + 每次 parse |
| 全文检索 / 字数统计 | 干净 | 去少量标记 | 去标签 | 需摊平 |

多端（Flutter / 小程序 / 网页）+ 将来段落评论是前提，Markdown 是性价比最高的选择。

**纯文本本身是合法 Markdown 的子集**：存量纯文本无需迁移，渲染层引入解析器即可，无需改存储层。

## 实现

### 落点

清洗函数 `htmlToMarkdown` 挂在**采集路径** `CrawlService.parseChapterContent` 的返回处，多页正文先按 `\n` 拼接再整体清洗。

```typescript
// crawl.service.ts
return parts.length > 0 ? htmlToMarkdown(parts.join('\n')) : null;
```

### 文件

- `src/admin/crawl/parser/content-cleaner.ts` — 新增，`htmlToMarkdown(content)` 统一入口。

### 清洗逻辑

`htmlToMarkdown` 自动区分两种输入：

1. **HTML 片段**（含标签）→ 用 cheerio 遍历，块级标签（`p`/`div`/`br`/`h1-6`/`li`/`blockquote` 等）作段落边界，块内文本压成一行，块间空行分隔；`<br>` 视作段落边界。
2. **纯文本**（无标签）→ 按连续空行切段，段内换行压空格。

## 边界

- **只对采集路径生效**。后台手动创建/编辑章节（`BookChapterService`）不强制清洗——人工填写的正文由用户掌控，将来编辑器可能直接产出 Markdown。
- **存量数据未迁移**。改造前的 HTML 正文（如 book 28）仍是旧格式；如需统一需一次性刷库，另行处理。

## 后续规划（段落评论）

段落评论不要求正文改格式。评论锚点独立存 `book_comment` 表，用 JSON 列存「章 ID + 段号/偏移」，锚点基于「空行切段」得到的段号，与正文格式解耦。

- 段号比字符偏移稳（正文编辑只影响后续段号，影响面可控）；
- 偏移量若用，应基于「渲染后的纯文本」而非 Markdown 源码计算。
