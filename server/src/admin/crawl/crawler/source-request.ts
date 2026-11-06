import iconv from 'iconv-lite';
import { parseUrlOptions, type HttpClient } from './http-client.js';
import { resolveUrl } from './url.js';
import { evalJs } from '../parser/js.js';
import { stripModePrefix } from '../parser/mode.js';

import type { BookSource } from '../../../common/model/book-source.js';

/**
 * 书源 → HTTP 请求参数的适配层：把书源里的自由文本配置（searchUrl、header）
 * 翻译成 HttpClient 能直接用的请求参数。
 *
 * 这层刻意不碰 DB、不碰规则引擎，输入输出都是纯数据，出错时降级而不是抛错——
 * 书源配置是人手填的，一条坏配置不该让整次采集失败。
 */

/** buildSearchRequest 的返回：一次搜索请求的完整参数 */
export interface SearchRequestConfig {
  method: 'GET' | 'POST';
  url: string;
  body: string;
  charset: string;
  headers: Record<string, string>;
}

/**
 * 解析书源 header（JSON 字符串）为请求头。
 *
 * 书源配置是人手填的：缺失、非法 JSON、非对象一律降级成「不带自定义头」，
 * 不能因为一条坏配置让整次采集抛错。
 */
export function sourceHeaders(source: BookSource): Record<string, string> {
  const raw = source.header;
  if (!raw || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      // 只接受标量：对象/数组作为请求头会被序列化成 "[object Object]"，等于埋了个坏头
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        headers[key] = String(value);
      }
    }
    return headers;
  } catch {
    return {};
  }
}

/** 响应体是 JSON（以 { 或 [ 开头且能解析）。搜索结果与章节目录都可能是 JSON 接口。 */
export function isJsonContent(html: string): boolean {
  const t = html.trim();
  return (t.startsWith('{') || t.startsWith('[')) && (() => {
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  })();
}

/**
 * 解析 searchUrl 为请求配置。
 *
 * 语法对齐 reader-rust：`url` 或 `url,{method,body,headers,charset}`。
 * - {key} 占位替换为 URL 编码后的关键词（POST 时按 charset 编码）
 * - {page} 占位替换为页码
 * - method 缺省 GET；body 缺省空；charset 缺省 utf-8
 *
 * 另外支持 `@js:` / `<js>` 形式：脚本返回真正的 URL。
 * 需要它的场景是「搜索地址会轮换」的站点——脚本先抓首页，从 `<form action>` 里读当前
 * 搜索地址，再拼关键词。脚本内可用 `java.ajax`（已接上带 cookie/header 的 HttpClient）
 * 与 `cookie.removeCookie`。
 */
export async function buildSearchRequest(
  source: BookSource,
  key: string,
  page: number,
  http: HttpClient,
): Promise<SearchRequestConfig> {
  const template = source.searchUrl!;
  const trimmed = template.trim();
  const headers = sourceHeaders(source);
  const sourceCharset = source.charset ?? 'utf-8';

  let urlPart: string;
  if (trimmed.startsWith('@js:') || trimmed.startsWith('js:') || trimmed.startsWith('<js>')) {
    const script = stripModePrefix(trimmed);
    urlPart = (
      await evalJs(script, {
        baseUrl: source.bookSourceUrl,
        key,
        page,
        sourceKey: source.bookSourceUrl,
        ajax: (spec) => {
          const { url } = parseUrlOptions(spec);
          return http
            .get(resolveUrl(source.bookSourceUrl, url), sourceCharset, headers)
            .then((html) => html ?? '');
        },
        clearCookies: (target) => http.clearCookies(target ? resolveUrl(source.bookSourceUrl, target) : undefined),
      })
    ).trim();
  } else {
    urlPart = template.replace(/\{key\}/g, encodeKey(key, sourceCharset)).replace(/\{page\}/g, String(page));
  }

  // 拆 url 与请求配置 JSON（`url,{...}` 形式，逗号后是合法 JSON 才拆）
  let config: { method?: string; body?: string; headers?: Record<string, string>; charset?: string } = {};
  const commaIdx = urlPart.indexOf(',');
  if (commaIdx >= 0) {
    const maybeJson = urlPart.slice(commaIdx + 1).trim();
    if (maybeJson.startsWith('{')) {
      try {
        config = JSON.parse(maybeJson);
        urlPart = urlPart.slice(0, commaIdx);
      } catch {
        // 不是合法 JSON，当普通 URL（含逗号）
      }
    }
  }

  const method = (config.method ?? 'GET').toUpperCase() as 'GET' | 'POST';
  // 搜索请求的编码优先级：searchUrl 内联配置 > 书源 charset > utf-8
  // （gbk 站点的 searchUrl 可能只写了 {key}，此时必须回落到书源级 charset，否则关键词编码错误）
  const charset = config.charset ?? sourceCharset;

  // 关键词编码：POST 表单时用 charset 对应的编码（gbk 站点需 gbk 编码 key）
  const encodedKey = encodeKey(key, charset);

  // body 里的 {key}/{page} 占位替换
  const body = (config.body ?? '').replace(/\{key\}/g, encodedKey).replace(/\{page\}/g, String(page));

  return {
    method,
    url: resolveUrl(source.bookSourceUrl, urlPart),
    body,
    charset,
    headers: { ...headers, ...config.headers },
  };
}

/**
 * 按目标编码对关键词做 URL 编码。
 * utf-8 用原生 encodeURIComponent；gbk/gb2312 等用 iconv-lite 编码成字节后百分号编码，
 * 否则 POST/GET 到 gbk 站点的表单时中文关键词会乱码。
 */
function encodeKey(key: string, charset: string): string {
  const cs = (charset || 'utf-8').toLowerCase();
  if (cs === 'utf-8' || cs === 'utf8') {
    return encodeURIComponent(key);
  }
  try {
    // 非 utf-8（如 gbk/gb2312）用 iconv-lite 编码后做百分号编码
    const bytes = iconv.encode(key, cs === 'gb2312' ? 'gb2312' : 'gbk');
    return Array.from(bytes)
      .map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
      .join('');
  } catch {
    return encodeURIComponent(key);
  }
}
