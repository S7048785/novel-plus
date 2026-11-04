import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { detectMode, stripModePrefix, ParseMode } from './mode.js';
import { selectText, selectElements, selectTextFromElement, splitReverse } from './html.js';
import { selectJsonPathFirst, selectJsonPathList } from './jsonpath.js';
import { selectXpathFirst } from './xpath.js';
import { applyLegadoRegex, splitRegexFromRule, selectRegexList } from './regex.js';
import { evalJs } from './js.js';

/**
 * 规则引擎主流程（复刻 reader-rust rule_engine.rs）
 *
 * 语义对齐 reader-rust：
 * - 列表规则（bookList/chapterList）用 select_list 选出「元素集合」，字段规则在「每个元素」上提取；
 * - 详情页字段（ruleBookInfo）在「整个 document」上提取；
 * - 正文（ruleContent）在「整个 document」上提取。
 */

export interface EvalContext {
  baseUrl: string;
  key?: string;
  page?: number;
  /** @put/@get 临时变量 */
  variables: Map<string, string>;
}

/** 拆出 <js>...</js> 或 @js: 后处理 */
function extractJs(rule: string): { pure: string; js: string | null } {
  const jsTagIdx = rule.indexOf('<js>');
  if (jsTagIdx >= 0) {
    const endIdx = rule.lastIndexOf('</js>');
    if (endIdx > jsTagIdx) {
      return { pure: rule.slice(0, jsTagIdx).trim(), js: rule.slice(jsTagIdx + 4, endIdx) };
    }
  }
  const atJsIdx = rule.indexOf('@js:');
  if (atJsIdx >= 0) {
    return { pure: rule.slice(0, atJsIdx).trim(), js: rule.slice(atJsIdx + 4) };
  }
  return { pure: rule, js: null };
}

/** 模板插值：{{js表达式}} → 执行结果；{key}/{page} → 值 */
async function interpolateTemplates(rule: string, input: string, ctx: EvalContext): Promise<string> {
  const re = /\{\{([\s\S]*?)\}\}/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rule)) !== null) {
    result += rule.slice(lastIndex, match.index);
    const expr = match[1];
    const val = await evalJs(expr, { input, baseUrl: ctx.baseUrl, key: ctx.key, page: ctx.page });
    result += val;
    lastIndex = match.index + match[0].length;
  }
  result += rule.slice(lastIndex);
  result = result.replace(/\{key\}/g, ctx.key ?? '');
  result = result.replace(/\{page\}/g, ctx.page != null ? String(ctx.page) : '');
  return result;
}

/** 处理 @put / @get */
function assignVars(body: string, ctx: EvalContext): void {
  const pairs = body
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      const k = pair.slice(0, colonIdx).trim();
      const v = pair.slice(colonIdx + 1).trim();
      ctx.variables.set(k, v);
    }
  }
}

/**
 * 摘掉规则开头的 `@put:{...}`，返回剩余部分。
 *
 * 为什么不能只认「整条规则就是 @put」：`@put:{k:v}@text` 这种「先存变量再取值」的写法
 * 在 legado 里是合法的，旧实现把 `@put:{k:v}` 当选择器交给 cheerio，直接抛
 * Unmatched selector 并中断整张列表。
 */
function takePutPrefix(rule: string, ctx: EvalContext): { rest: string } | null {
  if (!rule.startsWith('@put:{')) return null;
  let depth = 1;
  let i = 6; // '@put:{' 之后
  for (; i < rule.length; i++) {
    if (rule[i] === '{') depth += 1;
    else if (rule[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null; // 花括号没闭合，交给后续流程按普通规则处理
  assignVars(rule.slice(6, i), ctx);
  return { rest: rule.slice(i + 1).trim() };
}

function tryPutGet(rule: string, ctx: EvalContext): string | null {
  const getRe = /^@get:\{([\s\S]*)\}$/;
  const getMatch = rule.trim().match(getRe);
  if (getMatch) {
    return ctx.variables.get(getMatch[1].trim()) ?? '';
  }

  return null;
}

/**
 * 文档级字段提取：在整个 HTML/JSON 文档上提取单个字段。
 * 用于详情页（ruleBookInfo）、正文（ruleContent）。
 *
 * 单条规则出错只让该字段为 null，不向上抛：一条写错的规则不该让整页解析失败
 * （列表里 20 个字段错 1 个，用户期望是「少个字段」而不是「一条都抓不到」）。
 */
export async function evalFieldOnDoc(
  rule: string | undefined,
  content: string,
  ctx: EvalContext,
): Promise<string | null> {
  try {
    return await evalFieldOnDocInner(rule, content, ctx);
  } catch {
    return null;
  }
}

async function evalFieldOnDocInner(
  rule: string | undefined,
  content: string,
  ctx: EvalContext,
): Promise<string | null> {
  if (!rule || !rule.trim()) return null;
  let r = rule.trim();

  // @put 前缀：存变量后可继续带规则
  const put = takePutPrefix(r, ctx);
  if (put !== null) {
    if (!put.rest) return null;
    r = put.rest;
  }

  // 字段级 `||` 兜底：取第一个有值的分支（如简介三级兜底 og:description || #intro || meta[name=description]）
  const orParts = splitTopLevel(r, '||');
  if (orParts.length > 1) {
    for (const part of orParts) {
      const val = await evalFieldOnDocInner(part, content, ctx);
      if (val) return val;
    }
    return null;
  }

  const mode = detectMode(r, content);

  // JS 整条规则
  if (mode === ParseMode.Js) {
    const jsCode = stripModePrefix(r);
    const val = await evalJs(jsCode, { input: content, baseUrl: ctx.baseUrl, key: ctx.key, page: ctx.page });
    return val || null;
  }

  // @get
  const putGet = tryPutGet(r, ctx);
  if (putGet !== null) return putGet || null;

  // 模板插值
  const interpolated = await interpolateTemplates(r, content, ctx);

  // 拆 ## 替换
  const { pure: pureRule, regexPart } = splitRegexFromRule(interpolated);

  // 拆 JS 后处理
  const { pure, js } = extractJs(pureRule);

  let text: string | null = null;
  const actualMode = detectMode(pure, content);
  const stripped = stripModePrefix(pure);

  switch (actualMode) {
    case ParseMode.JsonPath:
      text = selectJsonPathFirst(content, stripped);
      break;
    case ParseMode.XPath:
      text = selectXpathFirst(content, stripped);
      break;
    case ParseMode.Regex:
      text = selectRegexList(content, stripped)[0] ?? null;
      break;
    case ParseMode.Css:
    default: {
      const $ = cheerio.load(content);
      // 根节点用 $.root() 而不是 $('body')：详情页的 og:* 元信息在 <head> 里，
      // 从 body 往下找会一律 0 命中（表现为「规则看着对但书名为空」）。
      text = selectText($, $.root(), stripped);
      break;
    }
  }

  if (js && text !== null) {
    text = await evalJs(js, { input: text, baseUrl: ctx.baseUrl, key: ctx.key, page: ctx.page });
  }
  if (regexPart && text !== null) {
    text = applyLegadoRegex(text, regexPart);
  }

  return text === null || text === '' ? null : text;
}

/**
 * 元素级字段提取：在单个元素上提取字段。
 * 用于搜索/发现/目录的字段（name/author/bookUrl/chapterName/chapterUrl）。
 *
 * 与文档级同理，单条规则抛错降级为 null，不拖垮整个列表项/整张表。
 */
async function evalFieldOnElement(
  rule: string,
  $: cheerio.CheerioAPI,
  el: cheerio.Cheerio<AnyNode>,
  ctx: EvalContext,
): Promise<string | null> {
  try {
    return await evalFieldOnElementInner(rule, $, el, ctx);
  } catch {
    return null;
  }
}

async function evalFieldOnElementInner(
  rule: string,
  $: cheerio.CheerioAPI,
  el: cheerio.Cheerio<AnyNode>,
  ctx: EvalContext,
): Promise<string | null> {
  let r = rule.trim();
  if (!r) return null;

  const put = takePutPrefix(r, ctx);
  if (put !== null) {
    if (!put.rest) return null;
    r = put.rest;
  }

  // 字段级 `||` 兜底（元素作用域）
  const orParts = splitTopLevel(r, '||');
  if (orParts.length > 1) {
    for (const part of orParts) {
      const val = await evalFieldOnElementInner(part, $, el, ctx);
      if (val) return val;
    }
    return null;
  }

  const mode = detectMode(r, el.html() ?? '');

  if (mode === ParseMode.Js) {
    const jsCode = stripModePrefix(r);
    const val = await evalJs(jsCode, { input: el.text() ?? '', baseUrl: ctx.baseUrl });
    return val || null;
  }

  const putGet = tryPutGet(r, ctx);
  if (putGet !== null) return putGet || null;

  const interpolated = await interpolateTemplates(r, el.text() ?? '', ctx);
  const { pure: pureRule, regexPart } = splitRegexFromRule(interpolated);
  const { pure, js } = extractJs(pureRule);

  let text: string | null = null;
  const stripped = stripModePrefix(pure);
  const actualMode = detectMode(pure, el.html() ?? '');

  if (actualMode === ParseMode.JsonPath) {
    text = selectJsonPathFirst(el.text() ?? '', stripped);
  } else if (actualMode === ParseMode.XPath) {
    text = selectXpathFirst(el.html() ?? '', stripped);
  } else if (actualMode === ParseMode.Regex) {
    text = selectRegexList(el.text() ?? '', stripped)[0] ?? null;
  } else {
    text = selectTextFromElement($, el, stripped);
  }

  if (js && text !== null) {
    text = await evalJs(js, { input: text, baseUrl: ctx.baseUrl });
  }
  if (regexPart && text !== null) {
    text = applyLegadoRegex(text, regexPart);
  }

  return text === null || text === '' ? null : text;
}

/**
 * 按优先级拆顶层操作符：`||` 最低、`&&` 次之、`%%` 最高。
 *
 * 旧实现从左往右扫、遇到哪个算哪个，并把最后一个操作符套用到所有片段上，
 * 于是 `a&&b||c` 会被当成 `a || b || c`（`&&` 语义被静默丢掉）。
 * 只在括号/方括号外切分，避免把 `:not([a||b])` 这类选择器切坏。
 */
function splitTopLevel(rule: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  let quote = '';
  for (let i = 0; i < rule.length; i++) {
    const ch = rule[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && rule.startsWith(op, i)) {
      parts.push(rule.slice(last, i));
      last = i + op.length;
      i += op.length - 1;
    }
  }
  parts.push(rule.slice(last));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** 交错合并（%%） */
function zip<T>(a: T[], b: T[]): T[] {
  const result: T[] = [];
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < a.length) result.push(a[i]);
    if (i < b.length) result.push(b[i]);
  }
  return result;
}

/**
 * 递归解析列表规则，按优先级组合元素集合：
 * `||` 取第一个有命中的分支、`&&` 依次拼接、`%%` 交错合并。
 */
function collectListElements(
  $: cheerio.CheerioAPI,
  doc: cheerio.Cheerio<AnyNode>,
  rule: string,
): cheerio.Cheerio<AnyNode>[] {
  const ors = splitTopLevel(rule, '||');
  if (ors.length > 1) {
    for (const part of ors) {
      const els = collectListElements($, doc, part);
      if (els.length > 0) return els;
    }
    return [];
  }

  const ands = splitTopLevel(rule, '&&');
  if (ands.length > 1) {
    const out: cheerio.Cheerio<AnyNode>[] = [];
    for (const part of ands) out.push(...collectListElements($, doc, part));
    return out;
  }

  const zips = splitTopLevel(rule, '%%');
  if (zips.length > 1) {
    let acc: cheerio.Cheerio<AnyNode>[] = [];
    for (const part of zips) acc = zip(acc, collectListElements($, doc, part));
    return acc;
  }

  // 叶子：`-` 倒序前缀在 stripModePrefix 之后单独摘（`-@css:.item` 也支持）
  const { rule: leaf, reverse } = splitReverse(stripModePrefix(rule));
  const els = selectElements($, doc, stripModePrefix(leaf));
  return reverse ? [...els].reverse() : els;
}

/**
 * 提取列表（搜索/发现/目录）：列表规则选出元素，字段规则在每个元素上提取。
 * 返回字段名 → 值的数组。
 */
export async function extractListFromHtml(
  listRule: string,
  fieldRules: Record<string, string | undefined>,
  content: string,
  baseUrl: string,
  key?: string,
  page?: number,
): Promise<Record<string, string>[]> {
  const ctx: EvalContext = { baseUrl, key, page, variables: new Map() };
  const $ = cheerio.load(content);
  const doc = $.root();

  const elements = collectListElements($, doc, listRule);

  if (elements.length === 0) return [];

  const results: Record<string, string>[] = [];
  for (const el of elements) {
    const record: Record<string, string> = {};
    for (const [field, rule] of Object.entries(fieldRules)) {
      if (!rule) continue;
      const val = await evalFieldOnElement(rule, $, el, ctx);
      if (val !== null) record[field] = val;
    }
    results.push(record);
  }
  return results;
}

/**
 * 提取列表（JSONPath 模式）：列表规则选数组，字段规则在每个元素上提取。
 */
export async function extractListFromJson(
  listRule: string,
  fieldRules: Record<string, string | undefined>,
  content: string,
  baseUrl: string,
): Promise<Record<string, string>[]> {
  const ctx: EvalContext = { baseUrl, variables: new Map() };
  const stripped = stripModePrefix(listRule);
  const items = selectJsonPathList(content, stripped);

  if (items.length === 0) return [];

  const results: Record<string, string>[] = [];
  for (const item of items) {
    const record: Record<string, string> = {};
    for (const [field, rule] of Object.entries(fieldRules)) {
      if (!rule) continue;
      const val = await evalFieldOnDoc(rule, item, ctx);
      if (val !== null) record[field] = val;
    }
    results.push(record);
  }
  return results;
}
