import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { detectMode, stripModePrefix, ParseMode } from './mode.js';
import { selectText, selectElements, selectTextFromElement, selectTextList } from './html.js';
import { selectJsonPathFirst, selectJsonPathList } from './jsonpath.js';
import { selectXpathFirst, selectXpathText } from './xpath.js';
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
function tryPutGet(rule: string, ctx: EvalContext): string | null {
  const putRe = /^@put:\{([\s\S]*)\}$/;
  const putMatch = rule.trim().match(putRe);
  if (putMatch) {
    const body = putMatch[1];
    const pairs = body.split(',').map((s) => s.trim()).filter(Boolean);
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > 0) {
        const k = pair.slice(0, colonIdx).trim();
        const v = pair.slice(colonIdx + 1).trim();
        ctx.variables.set(k, v);
      }
    }
    return '';
  }

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
 */
export async function evalFieldOnDoc(
  rule: string | undefined,
  content: string,
  ctx: EvalContext,
): Promise<string | null> {
  if (!rule || !rule.trim()) return null;
  const r = rule.trim();

  const mode = detectMode(r, content);

  // JS 整条规则
  if (mode === ParseMode.Js) {
    const jsCode = stripModePrefix(r);
    const val = await evalJs(jsCode, { input: content, baseUrl: ctx.baseUrl, key: ctx.key, page: ctx.page });
    return val || null;
  }

  // @put/@get
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
      text = selectText($, $('body'), stripped);
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
 */
async function evalFieldOnElement(
  rule: string,
  $: cheerio.CheerioAPI,
  el: cheerio.Cheerio<AnyNode>,
  ctx: EvalContext,
): Promise<string | null> {
  const r = rule.trim();
  if (!r) return null;

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

/** 列表组合规则拆分（&& / || / %%） */
function splitCombination(rule: string): { rules: string[]; op: '&&' | '||' | '%%' | '' } {
  let op: '&&' | '||' | '%%' | '' = '';
  const rules: string[] = [];
  let current = rule;
  while (current) {
    let found: { pos: number; op: '&&' | '||' | '%%' } | null = null;
    for (let i = 0; i < current.length - 1; i++) {
      const two = current.slice(i, i + 2);
      if (two === '&&' || two === '||' || two === '%%') {
        found = { pos: i, op: two as '&&' | '||' | '%%' };
        break;
      }
    }
    if (found) {
      rules.push(current.slice(0, found.pos).trim());
      op = found.op;
      current = current.slice(found.pos + 2).trim();
    } else {
      rules.push(current.trim());
      break;
    }
  }
  return { rules, op };
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
  const doc = $('body');

  // 列表规则可能带 && / || / %% 组合
  const { rules, op } = splitCombination(listRule);
  let elements: cheerio.Cheerio<AnyNode>[] = [];
  for (const rule of rules) {
    const stripped = stripModePrefix(rule);
    const partElements = selectElements($, doc, stripped);
    if (op === '||') {
      if (partElements.length > 0) {
        elements = partElements;
        break;
      }
    } else if (op === '%%') {
      elements = zip(elements, partElements);
    } else {
      elements = elements.concat(partElements);
    }
  }

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
