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

/** 结果扁平化为字符串列表 */
export function selectJsonPathList(content: string, path: string): string[] {
  const result = selectJsonPath(content, path);
  if (result == null) return [];
  if (Array.isArray(result)) {
    return result.map((v) => stringifyValue(v)).filter((v) => v !== null) as string[];
  }
  const s = stringifyValue(result);
  return s === null ? [] : [s];
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
