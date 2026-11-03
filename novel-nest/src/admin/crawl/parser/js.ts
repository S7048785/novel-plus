import { getQuickJS, Scope, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime } from 'quickjs-emscripten';
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
  /**
   * 网络桥：规则里的 java.ajax / java.get / java.post 走这里。
   *
   * 不传时退回裸 fetch（不带书源 header、不带 cookie），只适合纯公开接口；
   * 抓取站点的规则必须由调用方注入带 cookie/header 的实现，否则过不了反爬。
   */
  ajax?: (spec: string) => Promise<string>;
  /** 清空 cookie（对应 legado 的 cookie.removeCookie，用于换新会话） */
  clearCookies?: (url?: string) => void;
}


let quickJSModule: Awaited<ReturnType<typeof getQuickJS>> | null = null;

async function getModule() {
  if (!quickJSModule) {
    quickJSModule = await getQuickJS();
  }
  return quickJSModule;
}

/** 等 JS 里的异步（java.ajax）落定的超时上限 */
const JS_ASYNC_TIMEOUT_MS = 20_000;

/**
 * 等待 VM 内的 Promise 落定。
 *
 * 为什么需要：java.ajax 是宿主侧异步（fetch），脚本里 `String(java.ajax(url))` 拿到的是 Promise。
 * evalCode 只跑同步部分就返回，必须靠 executePendingJobs 把宿主回调推进 VM 才能拿到结果。
 * 不做这件事有两个后果：规则拿到 "[object Promise]"，以及**上下文销毁后异步回调仍在写句柄**——
 * QuickJS 会直接 assert 崩溃整个进程（实测过）。
 */
function settlePromise(ctx: QuickJSContext, rt: QuickJSRuntime, handle: QuickJSHandle): Promise<QuickJSHandle | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: QuickJSHandle | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    ctx.resolvePromise(handle).then(
      (res) => {
        if (res.error) {
          res.error.dispose();
          finish(null);
        } else {
          finish(res.value ?? null);
        }
      },
      () => finish(null),
    );

    const deadline = Date.now() + JS_ASYNC_TIMEOUT_MS;
    const tick = () => {
      if (done) return;
      if (Date.now() > deadline) {
        finish(null);
        return;
      }
      try {
        rt.executePendingJobs();
      } catch {
        finish(null);
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

/** 执行 JS 规则，返回结果字符串 */
export async function evalJs(script: string, opts: JsEvalOptions = {}): Promise<string> {
  const QuickJS = await getModule();
  const rt = QuickJS.newRuntime();
  const ctx = rt.newContext();
  const scope = new Scope();
  /** 上下文是否已销毁：晚到的异步回调不能再碰 ctx，否则 use-after-free */
  let disposed = false;
  /** 还在飞的宿主异步调用（java.ajax）。销毁前必须等它们全部落地，否则 QuickJS 会 assert 崩进程 */
  const asyncState = { pending: 0 };

  try {
    {
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
      ctx.setProp(
        cookieObj,
        'removeCookie',
        scope.manage(
          ctx.newFunction('removeCookie', (u) => {
            opts.clearCookies?.(u ? ctx.getString(u) : undefined);
            return ctx.newString('');
          }),
        ),
      );
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
      ctx.setProp(g, 'java', buildJavaObject(ctx, scope, opts, () => disposed, asyncState));

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

      // 先把还在飞的 java.ajax 全部推完（脚本可能是同步写法，拿不到 Promise 的值，但请求必须落地）
      const deadline = Date.now() + JS_ASYNC_TIMEOUT_MS;
      while (asyncState.pending > 0 && Date.now() < deadline) {
        rt.executePendingJobs();
        if (asyncState.pending === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      rt.executePendingJobs();

      let value = result.value;
      try {
        const state = ctx.getPromiseState(value);
        // notAPromise 说明结果是普通值，不用等
        if (!('notAPromise' in state && state.notAPromise)) {
          const settled = await settlePromise(ctx, rt, value);
          if (!settled) return '';
          value.dispose();
          value = settled;
        }
        return stringify(ctx.dump(value));
      } finally {
        value.dispose();
      }
    }
  } finally {
    disposed = true;
    scope.dispose();
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

function buildJavaObject(
  ctx: QuickJSContext,
  scope: Scope,
  opts: JsEvalOptions,
  isDisposed: () => boolean,
  asyncState: { pending: number },
): QuickJSHandle {
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

  // 异步网络函数（返回 Promise 句柄）。结果晚于上下文销毁到达时直接丢弃：
  // 那时再 ctx.newString 会 use-after-free，QuickJS 会把整个进程 assert 掉。
  const asyncFn = (name: string, impl: (args: QuickJSHandle[]) => Promise<string>) =>
    setFn(name, (args) => {
      const deferred = ctx.newPromise();
      asyncState.pending += 1;
      const settle = (value: string) => {
        if (isDisposed()) return;
        deferred.resolve(ctx.newString(value));
      };
      impl(args)
        .then(settle)
        .catch(() => settle(''))
        .finally(() => {
          asyncState.pending -= 1;
        });
      return deferred.handle;
    });

  asyncFn('ajax', (args) => runAjax(opts, ctx.getString(args[0])));
  strFn('md5Encode', (s) => md5(s));
  setFn('timeFormat', (args) => ctx.newString(timeFormat(ctx.getNumber(args[0]))));
  noArgStrFn('androidId', () => deviceId);
  noArgStrFn('deviceID', () => deviceId);
  asyncFn('get', (args) => runAjax(opts, ctx.getString(args[0])));
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

/** java.ajax / java.get 的统一实现：有网络桥走桥（带 cookie/header），否则退回裸 fetch */
function runAjax(opts: JsEvalOptions, spec: string): Promise<string> {
  const call = opts.ajax ? opts.ajax(spec) : javaAjax(spec);
  return call.catch(() => '');
}

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
