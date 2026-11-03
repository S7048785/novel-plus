# 书源规则语法完整参考

## 一、解析方式判定（detect_mode）

规则前缀优先级，其次自动检测：

```
@css: / @CSS:                     → CSS
@xpath: / @XPath: / @XPATH:       → XPath
@json: / @Json: / @JSON:          → JSONPath
@regex: / @Regex:                 → Regex
js: / @js: / <js>                 → Js
/ 或 ./ 开头                       → XPath
$. 或 $[ 开头                      → JSONPath
: 开头                             → Regex
content 是合法 JSON               → JSONPath（自动检测）
默认                               → CSS
```

## 二、CSS 选择器（默认方式）

### legado 风格兼容

| 写法 | 转成 |
|---|---|
| `class.mod block` | `.mod.block`（多 class） |
| `id.main` | `#main` |
| `tag.div` | `div` |
| `text.关键字` | 选自身文本含关键字的元素 |

### 索引

| 语法 | 说明 |
|---|---|
| `.list.0` / `.list.-1` | 第 1 个 / 最后 1 个 |
| `.list!0` | 排除第 1 个 |
| `a[0,2,-1]` | 多下标 |
| `a[1:3]` | 区间（含结束位） |
| `a[-1:0]` | 倒序 |
| `a[!1,2]` | 排除多下标 |

### 取值后缀（`@`）

| 后缀 | 说明 |
|---|---|
| `@text` | 文本 |
| `@textNodes` | 递归文本节点，`\n` 拼接 |
| `@ownText` | 仅自身直接文本 |
| `@html` / `@all` | 保留 HTML 标签 |
| `@href` / 任意属性名 | 取属性 |
| `@attr[href]` | 属性兼容写法 |

### 链式与二次解析

- `.a@h3@a@href`：`@` 链式向下选择
- `div@html@@a@href`：`@@` 把结果当 HTML 再解析

### 列表组合

仅在列表规则（bookList/chapterList）里支持，**官方只有两种**：

- `rule1&&rule2`：结果拼接
- `rule1%%rule2`：交错合并两个结果列表（第 1 列表第 1 项 + 第 2 列表第 1 项，依次交错）

> 注意：reader-rust 官方**没有 `||` 组合**（`||` 是 reader-dev 的扩展，官方规范只有 `&&` 和 `%%`）。

## 三、其他方式

### JSONPath（`$` 前缀，或字段名直接写）

```
$.data.list、$..name、$.data[0]
```

### XPath（`@xpath:` 前缀）

```
@xpath://div[@class='book']
```

### 正则

- 列表规则：`:...` 或 `@regex:...`，用 `$1`/`$2` 捕获组
- 替换：`##正则##替换##`，可串联多个（空格分隔），`###` 只替换首个

```json
// 多个替换串联
"author": ".author@text##^作者[:：]?## ##\\s+##"
// 只替换首个（末尾 ###）
"content": "#content@html##广告.*?## ###"
```

### JavaScript（三种写法）

```
js:...       整条规则是 JS
@js:...      字段提取后做 JS 后处理
<js>...</js> 等价 @js:
```

可访问变量：`input`/`result`/`src`（当前输入值）、`base_url`/`baseUrl`/`url`、`key`/`page`、`source`（含 `getKey()`）、`cache`（`get`/`put`）、`cookie`（仅 `removeCookie`）、`book`/`chapter`/`title`/`nextChapterUrl`（预留）。

`java.*` 方法：`ajax(spec)`、`get/post/put(url, body)`、`md5Encode`、`timeFormat`、`androidId`/`deviceID`、`base64Encode`/`base64Decode`、`encodeURIComponent`/`decodeURIComponent`/`encodeURI`/`decodeURI`、`now`、`uuid`。

全局函数：`kv_get`/`kv_put`、`regex_replace(input, pattern, replace)`、`strip_ws(input)`。

`js:` 规则返回数组/对象时，解析器自动序列化成 JSON 字符串。

`jsLib` 字段定义共享函数，在所有 JS 规则前注入：

```json
{
  "jsLib": "function cleanAuthor(v){ return v.replace(/^作者[:：]?/, '').trim(); }",
  "ruleSearch": { "author": ".author@text@js:cleanAuthor(input)" }
}
```

> 限制：JS 运行在 QuickJS，无 `document`/`window`；能不用 JS 就不用（先 CSS/XPath 缩小范围，再让 JS 处理字符串）。

## 四、模板与占位符

| 语法 | 说明 |
|---|---|
| `{key}` | 搜索词（自动按 charset 编码） |
| `{page}` | 页码 |
| `{{...}}` | 执行 JS 插入结果；JSON 规则里还支持直接取字段 `{{$.cover}}`、`{{id}}` |
| `@put:{k:v}` / `@get:{k}` | 临时变量 |

### formatJs（目录标题格式化）

`ruleToc.formatJs` 用模板字符串格式化章节标题，注入 `index`/`title` 变量：

```json
{ "ruleToc": { "formatJs": "`${index}. ${title}`" } }
```

## 五、书源字段结构

```typescript
interface BookSourceConfig {
  bookSourceName: string;
  bookSourceUrl: string;      // 源站根 URL
  charset?: string;           // 站点编码（gbk 站点必填，默认 utf-8）
  searchUrl?: string;         // 搜索 URL（可带 POST 配置）
  exploreUrl?: string;        // 发现页：分类::url{{page}} 多行
  jsLib?: string;             // 共享 JS 库
  ruleSearch?: SearchRule;
  ruleExplore?: SearchRule;
  ruleBookInfo?: BookInfoRule;
  ruleToc?: TocRule;
  ruleContent?: ContentRule;
}

// 各阶段字段（reader-rust 规范）
interface SearchRule {
  checkKeyWord?; bookList?; name?; author?; intro?; kind?;
  lastChapter?; updateTime?; bookUrl?; coverUrl?; wordCount?;
}
interface BookInfoRule {
  init?; name?; author?; intro?; kind?; lastChapter?; updateTime?;
  coverUrl?; wordCount?; tocUrl?; canReName?; downloadUrls?;
}
interface TocRule {
  preUpdateJs?; init?; chapterList?; chapterName?; chapterUrl?;
  formatJs?; isVolume?; isVip?; isPay?; updateTime?; nextTocUrl?;
}
interface ContentRule {
  content?; title?; nextContentUrl?; webJs?; sourceRegex?;
  replaceRegex?; imageStyle?; imageDecode?; payAction?;
}
```

## 六、searchUrl 的 GET/POST

```
GET:  /search?key={key}
GET+编码:  /search?key={key},{"charset":"gbk"}
POST: /e/search/,{"method":"POST","body":"show=title&keyboard={key}","headers":{"Content-Type":"application/x-www-form-urlencoded"}}
```

## 七、真实站点案例（已验证）

### 案例 1：七步阁（qibuge.com）— GBK + GET 搜索

```json
{
  "bookSourceUrl": "https://www.qibuge.com",
  "charset": "gbk",
  "searchUrl": "/search/?searchkey={key},{\"charset\":\"gbk\"}",
  "ruleSearch": {
    "bookList": ".novelslist2 ul li",
    "name": ".s2 a@text",
    "author": ".s4@text",
    "kind": ".s1@text",
    "lastChapter": ".s3 a@text",
    "bookUrl": ".s2 a@href"
  },
  "ruleExplore": {
    "bookList": "div.ll > div.item",
    "name": "dl > dt > a@text",
    "author": "dl > dt > span > a@text",
    "bookUrl": "dl > dt > a@href",
    "coverUrl": "div.image > a > img@src"
  },
  "ruleBookInfo": {
    "name": "#info h1@text",
    "author": "#info > p@text##作\\s*者[：:]\\s*",
    "intro": "#intro@text",
    "coverUrl": "#fmimg img@src"
  },
  "ruleToc": {
    "chapterList": "#list dd a",
    "chapterName": "@text",
    "chapterUrl": "@href"
  },
  "ruleContent": { "content": "#content@html" }
}
```

要点：GBK 站点 `charset:gbk`；搜索结果表头行靠 `.s2 a` 为空自动过滤；作者带"作者："前缀用正则去。

### 案例 2：书本书（shubenshu.com）— UTF-8 + POST 搜索 + 独立目录页 + 反爬陷阱

```json
{
  "bookSourceUrl": "https://www.shubenshu.com",
  "searchUrl": "/e/search/,{\"method\":\"POST\",\"body\":\"show=title,ftitle,writer&keyboard={key}\",\"headers\":{\"Content-Type\":\"application/x-www-form-urlencoded\"}}",
  "ruleExplore": {
    "bookList": "#hotcontent .item",
    "name": "dl > dt > a@text",
    "author": ".btm a@text",
    "bookUrl": "dl > dt > a@href",
    "coverUrl": ".image a img@data-original"
  },
  "ruleBookInfo": {
    "name": "#info h1@text",
    "author": "#info > p > a@text",
    "intro": "#intro@text",
    "coverUrl": "#fmimg img@data-original",
    "tocUrl": "a.chapterlist@href"
  },
  "ruleToc": {
    "chapterList": "#list a:not([style])",
    "chapterName": "dd@text",
    "chapterUrl": "@href"
  },
  "ruleContent": { "content": "#booktxt@html" }
}
```

要点：封面懒加载在 `data-original`；目录是独立页（`tocUrl` 指向 `/xxx_list/`）；目录 `a>dd` 反向嵌套；`#list a:not([style])` 过滤 `display:none` 的反爬陷阱链接。

### 案例 3：笔趣阁（bqquge.org）— UTF-8 + 数字 ID + 正文分页

```json
{
  "bookSourceUrl": "https://www.bqquge.org",
  "searchUrl": "/so?key={key}",
  "ruleExplore": {
    "bookList": ".item",
    "name": ".itemtxt h3 a@text",
    "author": ".itemtxt p a@text##作者[：:]\\s*",
    "bookUrl": ".itemtxt h3 a@href",
    "coverUrl": "a img@src"
  },
  "ruleBookInfo": {
    "name": ".booktxt h1@text",
    "author": ".booktxt p > a@text##作者[：:]\\s*",
    "intro": ".des@text",
    "coverUrl": ".bookdetail > img@src"
  },
  "ruleToc": {
    "chapterList": "#list li a",
    "chapterName": "@text",
    "chapterUrl": "@href"
  },
  "ruleContent": {
    "content": ".con@html",
    "nextContentUrl": "text.下一页@href"
  }
}
```

要点：书籍 URL 是数字 ID（`/7447`）；正文有分页（`-2`/`-3` 后缀），用 `text.下一页@href` 匹配"下一页"文本（最后一页文本变"下一章"→ 返回 null 自然终止分页）。
