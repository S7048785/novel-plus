import { getQuickJS, Scope, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';
import { createHash, randomUUID } from 'node:crypto';

/**
 * JS 引擎（quickjs-emscripten），复刻 reader-rust src/parser/js.rs
 *
 * 每次求值创建独立 Runtime + Context，用 Scope.withScope 管理句柄生命周期，
 * 注入 legado 兼容的宿主对象（input/result/src/base_url/key/page/source/cache/cookie/java 等）。
 *
 * 注意 quickjs-emscripten 的约定：
 * - newFunction 回调的参数是 QuickJSHandle，需用 ctx.getString/getNumber 解包；
 * - 回调返回值必须是 QuickJSHandle，且不能自行 dispose（由 quickjs 接管）。
 */

export interface JsEvalOptions {
  input?: string;
  baseUrl?: string;
  key?: string;
  page?: number;
  sourceKey?: string;
}

let quickJSModule: Awaited<ReturnType<typeof getQuickJS>> | null = null;

async function getModule() {
  if (!quickJSModule) {
    quickJSModule = await getQuickJS();
  }
  return quickJSModule;
}

/** 执行 JS 规则，返回结果字符串 */
export async function evalJs(script: string, opts: JsEvalOptions = {}): Promise<string> {
  const QuickJS = await getModule();
  const rt = QuickJS.newRuntime();
  const ctx = rt.newContext();

  try {
    return await Scope.withScope((scope) => {
      const input = opts.input ?? '';
      const baseUrl = opts.baseUrl ?? '';

      const g = ctx.global;
      setString(ctx, scope, g, 'input', input);
      setString(ctx, scope, g, 'result', input);
      setString(ctx, scope, g, 'src', input);
      setString(ctx, scope, g, 'base_url', baseUrl);
      setString(ctx, scope, g, 'baseUrl', baseUrl);
      setString(ctx, scope, g, 'url', baseUrl);
      if (opts.key !== undefined) setString(ctx, scope, g, 'key', opts.key);
      if (opts.page !== undefined) ctx.setProp(g, 'page', scope.manage(ctx.newNumber(opts.page)));

      // source 对象
      const sourceObj = scope.manage(ctx.newObject());
      ctx.setProp(sourceObj, 'key', scope.manage(ctx.newString(opts.sourceKey ?? '')));
      ctx.setProp(sourceObj, 'getKey', scope.manage(ctx.newFunction('getKey', () => ctx.newString(opts.sourceKey ?? ''))));
      ctx.setProp(g, 'source', sourceObj);

      // cookie 占位
      const cookieObj = scope.manage(ctx.newObject());
      ctx.setProp(cookieObj, 'removeCookie', scope.manage(ctx.newFunction('removeCookie', () => ctx.newString(''))));
      ctx.setProp(g, 'cookie', cookieObj);

      // cache（内存 KV）
      const cacheObj = scope.manage(ctx.newObject());
      ctx.setProp(
        cacheObj,
        'get',
        scope.manage(ctx.newFunction('get', (k) => ctx.newString(jsKv.get(ctx.getString(k)) ?? ''))),
      );
      ctx.setProp(
        cacheObj,
        'put',
        scope.manage(
          ctx.newFunction('put', (k, v) => {
            jsKv.set(ctx.getString(k), ctx.getString(v));
            return ctx.newNumber(1);
          }),
        ),
      );
      ctx.setProp(g, 'cache', cacheObj);

      // java 对象
      ctx.setProp(g, 'java', buildJavaObject(ctx, scope));

      // 全局函数
      ctx.setProp(g, 'kv_get', scope.manage(ctx.newFunction('kv_get', (k) => ctx.newString(jsKv.get(ctx.getString(k)) ?? ''))));
      ctx.setProp(
        g,
        'kv_put',
        scope.manage(
          ctx.newFunction('kv_put', (k, v) => {
            jsKv.set(ctx.getString(k), ctx.getString(v));
            return ctx.newNumber(1);
          }),
        ),
      );
      ctx.setProp(
        g,
        'regex_replace',
        scope.manage(
          ctx.newFunction('regex_replace', (input, pattern, replace) => {
            try {
              const r = ctx
                .getString(input)
                .replace(new RegExp(ctx.getString(pattern), 'g'), ctx.getString(replace));
              return ctx.newString(r);
            } catch {
              return input;
            }
          }),
        ),
      );
      ctx.setProp(
        g,
        'strip_ws',
        scope.manage(ctx.newFunction('strip_ws', (input) => ctx.newString(ctx.getString(input).replace(/\s+/g, ' ').trim()))),
      );

      // 预留对象
      ctx.setProp(g, 'book', scope.manage(ctx.newObject()));
      ctx.setProp(g, 'chapter', scope.manage(ctx.newObject()));
      setString(ctx, scope, g, 'title', '');
      setString(ctx, scope, g, 'nextChapterUrl', '');
      ctx.setProp(g, 'rssArticle', scope.manage(ctx.newObject()));

      const result = ctx.evalCode(script);
      if (result.error) {
        result.error.dispose();
        return '';
      }
      const dumped = ctx.dump(result.value);
      result.value.dispose();
      return stringify(dumped);
    });
  } finally {
    ctx.dispose();
    rt.dispose();
  }
}

function setString(ctx: QuickJSContext, scope: Scope, obj: QuickJSHandle, key: string, value: string) {
  ctx.setProp(obj, key, scope.manage(ctx.newString(value)));
}

function stringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function buildJavaObject(ctx: QuickJSContext, scope: Scope): QuickJSHandle {
  const java = scope.manage(ctx.newObject());

  const setFn = (name: string, impl: (args: QuickJSHandle[]) => QuickJSHandle) =>
    ctx.setProp(java, name, scope.manage(ctx.newFunction(name, (...args) => impl(args))));

  // 同步字符串函数
  const strFn = (name: string, impl: (s: string) => string) =>
    setFn(name, (args) => ctx.newString(impl(ctx.getString(args[0]))));

  // 无参字符串函数
  const noArgStrFn = (name: string, impl: () => string) => setFn(name, () => ctx.newString(impl()));

  // 无参数字函数
  const noArgNumFn = (name: string, impl: () => number) => setFn(name, () => ctx.newNumber(impl()));

  // 异步网络函数（返回 Promise 句柄）
  const asyncFn = (name: string, impl: (args: QuickJSHandle[]) => Promise<string>) =>
    setFn(name, (args) => {
      const deferred = ctx.newPromise();
      impl(args)
        .then((value) => deferred.resolve(ctx.newString(value)))
        .catch(() => deferred.resolve(ctx.newString('')));
      return deferred.handle;
    });

  asyncFn('ajax', (args) => javaAjax(ctx.getString(args[0])).catch(() => ''));
  strFn('md5Encode', (s) => md5(s));
  setFn('timeFormat', (args) => ctx.newString(timeFormat(ctx.getNumber(args[0]))));
  noArgStrFn('androidId', () => deviceId);
  noArgStrFn('deviceID', () => deviceId);
  asyncFn('get', (args) => simpleRequest('GET', ctx.getString(args[0])).catch(() => ''));
  asyncFn('post', (args) => simpleRequest('POST', ctx.getString(args[0]), ctx.getString(args[1])).catch(() => ''));
  asyncFn('put', (args) => simpleRequest('PUT', ctx.getString(args[0]), ctx.getString(args[1])).catch(() => ''));
  strFn('base64Encode', (s) => Buffer.from(s).toString('base64'));
  strFn('base64Decode', (s) => {
    try {
      return Buffer.from(s, 'base64').toString('utf8');
    } catch {
      return '';
    }
  });
  strFn('encodeURIComponent', (s) => encodeURIComponent(s));
  strFn('decodeURIComponent', (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return '';
    }
  });
  strFn('encodeURI', (s) => encodeURI(s));
  strFn('decodeURI', (s) => {
    try {
      return decodeURI(s);
    } catch {
      return '';
    }
  });
  noArgNumFn('now', () => Date.now());
  noArgStrFn('uuid', () => randomUUID());

  return java;
}

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

function timeFormat(ts: number): string {
  const secs = ts > 1_000_000_000_000 ? ts / 1000 : ts;
  const d = new Date(secs * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const deviceId = randomUUID().replace(/-/g, '');

/** 内存 KV（对齐 reader-rust 的 JS_KV 静态缓存） */
const jsKv = new Map<string, string>();

async function simpleRequest(method: string, url: string, body?: string): Promise<string> {
  const res = await fetch(url, {
    method,
    body,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0' },
  });
  return res.text();
}

async function javaAjax(spec: string): Promise<string> {
  const { url, options } = splitAjaxSpec(spec);
  if (!url.trim()) return '';
  let method = 'GET';
  let headers: Record<string, string> = {};
  let body: string | undefined;
  try {
    const opts = options ? JSON.parse(options) : {};
    if (opts.method) method = String(opts.method).toUpperCase();
    if (opts.headers && typeof opts.headers === 'object') headers = opts.headers;
    if (opts.body != null) body = String(opts.body);
  } catch {
    // 忽略 options 解析错误
  }
  const res = await fetch(url.trim(), { method, headers, body });
  return res.text();
}

function splitAjaxSpec(spec: string): { url: string; options?: string } {
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if ((ch === '"' || ch === "'") && inString && ch === quote) {
      inString = false;
      quote = '';
    } else if ((ch === '"' || ch === "'") && !inString) {
      inString = true;
      quote = ch;
    } else if ((ch === '{' || ch === '[') && !inString) {
      depth++;
    } else if ((ch === '}' || ch === ']') && !inString) {
      depth--;
    } else if (ch === ',' && !inString && depth === 0) {
      return { url: spec.slice(0, i), options: spec.slice(i + 1).trim() };
    }
  }
  return { url: spec };
}
