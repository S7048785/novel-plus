import { JSONPath } from 'jsonpath-plus';

/**
 * JSONPath 提取器（jsonpath-plus）
 *
 * 规则支持 `$.data.list`、`$..name`、`$.data[0]`；字段规则可直接写字段名（省略 $.）。
 */
export function selectJsonPath(content: string, path: string): unknown {
  const p = path.trim();
  const expr = p.startsWith('$') ? p : `$.${p}`;
  try {
    const json = JSON.parse(content);
    return JSONPath({ path: expr, json, wrap: false });
  } catch {
    return null;
  }
}

/**
 * 结果扁平化为字符串列表。
 *
 * 为什么要展开一层数组：`$..list`（递归下降）命中的是「数组节点本身」，
 * jsonpath-plus 返回的是一层嵌套数组 `[[{...},{...}]]`。不展开的话整个数组会被
 * JSON.stringify 成一条记录，后续字段规则在字符串上再也取不到值——表现是
 * 「规则写对了但每条记录都是空对象」。
 */
export function selectJsonPathList(content: string, path: string): string[] {
  const result = selectJsonPath(content, path);
  if (result == null) return [];
  const items = Array.isArray(result) ? result.flatMap((v) => (Array.isArray(v) ? v : [v])) : [result];
  return items.map((v) => stringifyValue(v)).filter((v) => v !== null) as string[];
}

export function selectJsonPathFirst(content: string, path: string): string | null {
  return selectJsonPathList(content, path)[0] ?? null;
}

function stringifyValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
