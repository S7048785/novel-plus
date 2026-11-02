import * as cheerio from 'cheerio';
import type { AnyNode, Text } from 'domhandler';

/**
 * CSS/HTML 提取器（复刻 reader-rust src/parser/html.rs）
 *
 * 支持：
 * - legado 风格选择器：class.xxx / id.xxx / tag.xxx / text.关键字 / children
 * - 索引：.0 / .-1 / .!0 / [0,2,-1] / [1:3] / [-1:0] / [!1,2]
 * - 取值后缀：@text / @textNodes / @ownText / @html / @all / @href / @attr[x]
 * - 链式 @ 选择，@@ 二次解析，&& / || / %% 列表组合
 */

type CheerioAPI = cheerio.CheerioAPI;
type El = cheerio.Cheerio<AnyNode>;

interface IndexItem {
  kind: 'single' | 'range';
  value?: number;
  start?: number | null;
  end?: number | null;
  step?: number | null;
}

interface ParsedSelector {
  base: 'css' | 'children' | 'text';
  cssSelector?: string;
  text?: string;
  explicitIndex: boolean;
  indexMode: 'select' | 'exclude';
  indexItems: IndexItem[];
}

const SELECT = 'select';
const EXCLUDE = 'exclude';

function legadoToCss(selector: string): string {
  const s = selector.trim();
  if (s.startsWith('class.')) {
    const rest = s.slice(6);
    const classes = rest.split(/\s+/).filter(Boolean);
    if (classes.length > 1) return `.${classes.join('.')}`;
    return `.${rest.trim()}`;
  }
  if (s.startsWith('id.')) return `#${s.slice(3)}`;
  if (s.startsWith('tag.')) return s.slice(4);
  if (s.startsWith('.')) return s;
  if (s.startsWith('#') || s.startsWith('[')) return s;
  // 裸字母开头（如 div、div.ll > div.item、div item）是标准 CSS，原样透传。
  // 注意：不能像 legado 那样把「字母+空格」拆成多 class（那会把标准 CSS 的
  // 后代/子选择器 `div.ll > div.item` 误判成 `div.ll.>.div.item`）。
  return s;
}

function parseSelectorBase(selector: string): Pick<ParsedSelector, 'base' | 'cssSelector' | 'text'> {
  const s = selector.trim();
  if (s === '' || s === 'children') return { base: 'children' };
  if (s.startsWith('text.')) return { base: 'text', text: s.slice(5).trim() };
  return { base: 'css', cssSelector: legadoToCss(s) };
}

function parseBracketIndexSpec(selector: string): { base: string; indexMode: 'select' | 'exclude'; indexItems: IndexItem[] } | null {
  const s = selector.trim();
  if (!s.endsWith(']')) return null;
  const start = s.lastIndexOf('[');
  if (start < 0) return null;
  const base = s.slice(0, start).trim();
  let inner = s.slice(start + 1, -1).trim();
  let indexMode: 'select' | 'exclude' = SELECT;
  if (inner.startsWith('!')) {
    inner = inner.slice(1).trim();
    indexMode = EXCLUDE;
  }
  const items: IndexItem[] = [];
  if (inner) {
    for (const part of inner.split(',')) {
      const p = part.trim();
      if (!p) continue;
      const item = parseBracketIndexItem(p);
      if (!item) return null;
      items.push(item);
    }
  }
  return { base, indexMode, indexItems: items };
}

function parseBracketIndexItem(part: string): IndexItem | null {
  if (part.includes(':')) {
    const seg = part.split(':');
    if (seg.length < 2 || seg.length > 3) return null;
    const start = parseOptionalInt(seg[0]);
    const end = parseOptionalInt(seg[1]);
    if (start === undefined || end === undefined) return null;
    const step = seg[2] ? parseOptionalInt(seg[2]) ?? 1 : 1;
    return { kind: 'range', start, end, step };
  }
  const v = parseInt(part, 10);
  if (Number.isNaN(v)) return null;
  return { kind: 'single', value: v };
}

function parseOptionalInt(part: string): number | null | undefined {
  const p = part.trim();
  if (!p) return null;
  const v = parseInt(p, 10);
  if (Number.isNaN(v)) return undefined;
  return v;
}

function parseLegacyIndexSpec(selector: string): { base: string; indexMode: 'select' | 'exclude'; indexItems: IndexItem[] } | null {
  for (const [delimiter, mode] of [
    ['!', EXCLUDE],
    ['.', SELECT],
  ] as const) {
    const pos = selector.lastIndexOf(delimiter);
    if (pos < 0) continue;
    const base = selector.slice(0, pos).trim();
    const tail = selector.slice(pos + 1).trim();
    if (!tail) continue;
    const items: IndexItem[] = [];
    for (const part of tail.split(':')) {
      const p = part.trim();
      if (!p) return null;
      const v = parseInt(p, 10);
      if (Number.isNaN(v)) return null;
      items.push({ kind: 'single', value: v });
    }
    return { base, indexMode: mode, indexItems: items };
  }
  return null;
}

function parseSelectorWithIndex(selector: string): ParsedSelector {
  const s = selector.trim();
  const bracket = parseBracketIndexSpec(s);
  if (bracket) {
    return { ...parseSelectorBase(bracket.base), explicitIndex: true, indexMode: bracket.indexMode, indexItems: bracket.indexItems };
  }
  const legacy = parseLegacyIndexSpec(s);
  if (legacy) {
    return { ...parseSelectorBase(legacy.base), explicitIndex: true, indexMode: legacy.indexMode, indexItems: legacy.indexItems };
  }
  return { ...parseSelectorBase(s), explicitIndex: false, indexMode: SELECT, indexItems: [] };
}

/** 元素自身直接文本节点 */
function ownText($: CheerioAPI, el: El): string {
  let text = '';
  el.contents().each((_, node) => {
    if (node.type === 'text') text += (node as Text).data ?? '';
  });
  return text;
}

/** 在 element 作用域内查找（cheerio find 是后代，不含自身；children 是直接子） */
function findFrom($: CheerioAPI, el: El, selector: string): El {
  return el.find(selector);
}

function collectMatchesFromElement($: CheerioAPI, el: El, selector: ParsedSelector): AnyNode[] {
  let matches: AnyNode[];
  if (selector.base === 'children') {
    matches = el.children().toArray();
  } else if (selector.base === 'text') {
    const needle = selector.text ?? '';
    const result: AnyNode[] = [];
    if (ownText($, el).includes(needle)) result.push(...el.toArray());
    el.find('*').each((_, child) => {
      if (ownText($, $(child)).includes(needle)) result.push(child);
    });
    matches = result;
  } else {
    matches = findFrom($, el, selector.cssSelector ?? '').toArray();
  }
  return applyIndices(matches, selector);
}

function collectMatches($: CheerioAPI, root: El, selector: ParsedSelector): AnyNode[] {
  let matches: AnyNode[];
  if (selector.base === 'children') {
    matches = [];
  } else if (selector.base === 'text') {
    const needle = selector.text ?? '';
    matches = root
      .find('*')
      .filter((_, el) => ownText($, $(el)).includes(needle))
      .toArray();
  } else {
    matches = root.find(selector.cssSelector ?? '').toArray();
  }
  return applyIndices(matches, selector);
}

function applyIndices(matches: AnyNode[], selector: ParsedSelector): AnyNode[] {
  if (!selector.explicitIndex) return matches;
  const resolved = resolveIndices(matches.length, selector.indexItems);
  if (selector.indexMode === EXCLUDE) {
    const excludeSet = new Set(resolved);
    return matches.filter((_, idx) => !excludeSet.has(idx));
  }
  return resolved.filter((idx) => idx < matches.length).map((idx) => matches[idx]);
}

function resolveIndices(len: number, items: IndexItem[]): number[] {
  if (len === 0) return [];
  const seen = new Set<number>();
  const resolved: number[] = [];
  for (const item of items) {
    for (const idx of expandIndexItem(len, item)) {
      if (!seen.has(idx)) {
        seen.add(idx);
        resolved.push(idx);
      }
    }
  }
  return resolved;
}

function expandIndexItem(len: number, item: IndexItem): number[] {
  if (item.kind === 'single') {
    const n = normalizeIndex(item.value ?? 0, len);
    return n === null ? [] : [n];
  }
  return expandRange(len, item.start ?? null, item.end ?? null, item.step ?? 1);
}

function normalizeIndex(index: number, len: number): number | null {
  const resolved = index < 0 ? len + index : index;
  if (resolved < 0 || resolved >= len) return null;
  return resolved;
}

function expandRange(len: number, start: number | null, end: number | null, step: number): number[] {
  if (len === 0) return [];
  let s = start ?? 0;
  let e = end ?? len - 1;
  if (s < 0) s += len;
  if (e < 0) e += len;
  if ((s < 0 && e < 0) || (s >= len && e >= len)) return [];
  s = Math.max(0, Math.min(len - 1, s));
  e = Math.max(0, Math.min(len - 1, e));
  const st = step > 0 ? step : -step < len ? Math.max(1, step + len) : 1;

  const indices: number[] = [];
  if (s <= e) {
    for (let cur = s; cur <= e; cur += st) indices.push(cur);
  } else {
    for (let cur = s; cur >= e; cur -= st) {
      indices.push(cur);
      if (cur <= e || cur < st) break;
    }
  }
  return indices;
}

function extractText($: CheerioAPI, el: El, extractor: string): string | null {
  const ex = extractor.trim();
  switch (ex) {
    case 'text':
    case '@text': {
      const text = el.text().trim();
      return text ? text : null;
    }
    case 'textNodes':
    case '@textNodes': {
      const text = getTextNodes($, el);
      return text ? text : null;
    }
    case 'ownText':
    case '@ownText': {
      const text = ownText($, el).replace(/\s+/g, ' ').trim();
      return text ? text : null;
    }
    case 'html':
    case '@html':
    case 'all':
    case '@all':
      return el.html();
    default: {
      const attrName = parseAttrExtractor(ex);
      if (attrName) return el.attr(attrName) ?? null;
      if (ex.startsWith('@')) return el.attr(ex.slice(1)) ?? null;
      return el.attr(ex) ?? null;
    }
  }
}

function parseAttrExtractor(extractor: string): string | null {
  const ex = extractor.trim().replace(/^@/, '');
  if (ex.startsWith('attr[') && ex.endsWith(']')) {
    const inner = ex.slice(5, -1);
    return inner ? inner : null;
  }
  return null;
}

function getTextNodes($: CheerioAPI, el: El): string {
  const texts: string[] = [];
  collectTextNodes($, el, texts);
  return texts.join('\n');
}

function collectTextNodes($: CheerioAPI, el: El, texts: string[]): void {
  el.contents().each((_, node) => {
    if (node.type === 'text') {
      const text = ((node as Text).data ?? '').trim();
      if (text) texts.push(text);
    } else if (node.type === 'tag') {
      collectTextNodes($, $(node), texts);
    }
  });
}

export function selectTextList($: CheerioAPI, doc: El, rule: string): string[] {
  if (rule.includes('@@')) {
    const rules = rule.split('@@');
    let currentTexts = selectTextList($, doc, rules[0]);
    for (const r of rules.slice(1)) {
      if (currentTexts.length === 0) break;
      const newTexts: string[] = [];
      for (const text of currentTexts) {
        const sub = cheerio.load(text);
        newTexts.push(...selectTextList(sub, sub('body'), r));
      }
      currentTexts = newTexts;
    }
    return currentTexts;
  }

  const parts = rule.split('@');
  if (parts.length === 0) return [];

  const firstPart = parts[0].trim();
  const matches = collectMatches($, doc, parseSelectorWithIndex(firstPart));
  if (matches.length === 0) return [];

  const results: string[] = [];
  for (const el of matches) {
    if (parts.length > 1) {
      const rest = parts.slice(1).join('@');
      const v = selectTextFromElement($, $(el), rest);
      if (v !== null) results.push(v);
    } else {
      const v = extractText($, $(el), 'text');
      if (v !== null) results.push(v);
    }
  }
  return results;
}

export function selectText($: CheerioAPI, doc: El, rule: string): string | null {
  return selectTextList($, doc, rule)[0] ?? null;
}

/** 列表规则：按 selector 选出元素集合（不含取值后缀，用于列表项） */
export function selectElements($: CheerioAPI, doc: El, selector: string): El[] {
  const parsed = parseSelectorWithIndex(selector);
  const matches = collectMatches($, doc, parsed);
  return matches.map((node) => $(node));
}

/** 元素级：在单个元素上用规则提取（含链式 @ 和取值后缀） */
export function selectTextFromElement($: CheerioAPI, el: El, rule: string): string | null {
  const parts = rule.split('@');
  let currentMatches: AnyNode[] = [el.get(0)!];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    if (i === parts.length - 1) {
      for (const current of currentMatches) {
        const text = extractText($, $(current), part);
        if (text !== null) return text;
      }
      return null;
    }

    const parsed = parseSelectorWithIndex(part);
    const nextMatches: AnyNode[] = [];
    for (const current of currentMatches) {
      nextMatches.push(...collectMatchesFromElement($, $(current), parsed));
    }
    if (nextMatches.length === 0) return null;
    currentMatches = nextMatches;
  }

  for (const current of currentMatches) {
    const text = extractText($, $(current), 'text');
    if (text !== null) return text;
  }
  return null;
}
