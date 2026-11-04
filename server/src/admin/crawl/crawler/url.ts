/**
 * URL 工具：相对路径补全（对齐 reader-rust 的 resolve_url / normalize_source_url）
 */

export function isAbsolute(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export function origin(url: string): string | null {
  if (!isAbsolute(url)) return null;
  const m = url.trim().match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : null;
}

/** 以 baseUrl 为基准补全相对 URL */
export function resolveUrl(baseUrl: string, url: string): string {
  const u = url.trim();
  if (!u) return '';
  if (isAbsolute(u)) return u;
  try {
    return new URL(u, baseUrl).toString();
  } catch {
    return u;
  }
}
