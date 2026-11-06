/**
 * HTTP 抓取客户端（复刻 novel-crawl 的 CrawlHttpClient + reader-rust 的 fetcher）
 *
 * 能力：随机 User-Agent、编码转换（gbk 等）、失败重试、请求间隔、可选代理、
 * Cookie 会话、URL 内联请求选项（`,{"retry":2}`）。
 *
 * 为什么把「Cookie 会话 + 403 重发」放在这一层而不是写进规则：
 * 这类站点的反爬是**站点级**行为（首次请求 403 并下发 cookie，带 cookie 再来一次就是 200），
 * 与具体规则无关。写进规则意味着每个书源都要抄一遍 @js + retry 后缀，
 * 且 ruleSearch / ruleToc / ruleContent 各处都得记得加。放在请求层，所有书源自动受益。
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
];

/**
 * 小于这个长度的响应视为「疑似空壳」并重试。
 * 采集站被限频/被墙时常返回 200 + 几十字节的提示页，不重试会被当成「解析失败」，误导规则调试。
 */
const MIN_BODY_LENGTH = 1500;

/** 403 + Set-Cookie 时的最大即时重发次数（站点级二次验证一般一次就过） */
const MAX_COOKIE_RETRIES = 2;

/** URL 内联的请求选项：`url,{"retry":2,"timeout":8000}` */
export interface UrlOptions {
  retry?: number;
  timeout?: number;
  charset?: string;
  headers?: Record<string, string>;
}

export interface HttpClientOptions {
  /** 请求间隔（毫秒），默认随机 300-500 */
  intervalMin?: number;
  intervalMax?: number;
  /** 失败重试次数，默认 3 */
  retryCount?: number;
  /** 代理 */
  proxy?: string;
}

/** 站点可达性探测结果 */
export interface SiteProbeResult {
  /** 最终响应是否 2xx（3xx 已被 fetch 跟随，这里看的是跟随之后的状态） */
  ok: boolean;
  /** HTTP 状态码；0 = 请求没到达（DNS 解析失败、超时、证书错误等） */
  status: number;
  costMs: number;
  /** 跟随重定向后的最终地址（能发现 http→https、旧域名跳转） */
  finalUrl: string;
  contentType?: string;
  /** 响应体字节数（不是字符数：gbk 站点按字符算会少一半，判断空壳页会误判） */
  bodyBytes: number;
  /** 实际用于解码的编码，便于核对「编码填错了」 */
  charset: string;
  /** 页面标题，验证码页/空壳页往往一眼能看出来 */
  title?: string;
  /** 首次 403 且下发 cookie 时，带 cookie 重试是否成功（站点级二次验证） */
  cookieRetried?: boolean;
  /** status=0 时的原因 */
  error?: string;
}

/** 可达性探测的默认超时：比采集宽松一点（要覆盖慢站），但不能让管理员干等 */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * 拆出 URL 与内联 JSON 选项。
 * 只有当逗号后面是合法 JSON 对象时才拆，避免把 URL 里本来就有的逗号当分隔符。
 */
export function parseUrlOptions(raw: string): { url: string; options: UrlOptions } {
  const commaIdx = raw.indexOf(',');
  if (commaIdx < 0) return { url: raw.trim(), options: {} };
  const tail = raw.slice(commaIdx + 1).trim();
  if (!tail.startsWith('{')) return { url: raw.trim(), options: {} };
  try {
    const parsed: unknown = JSON.parse(tail);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { url: raw.trim(), options: {} };
    }
    return { url: raw.slice(0, commaIdx).trim(), options: parsed as UrlOptions };
  } catch {
    return { url: raw.trim(), options: {} };
  }
}

export class HttpClient {
  private readonly intervalMin: number;
  private readonly intervalMax: number;
  private readonly retryCount: number;
  private readonly proxy?: string;

  /**
   * Cookie 罐：host → (name → value)。
   * 进程内共享、不落库：cookie 只是过反爬的一次性凭据，重启后重新握手即可。
   */
  private readonly cookieJar = new Map<string, Map<string, string>>();

  constructor(opts: HttpClientOptions = {}) {
    this.intervalMin = opts.intervalMin ?? 300;
    this.intervalMax = opts.intervalMax ?? 500;
    this.retryCount = opts.retryCount ?? 3;
    this.proxy = opts.proxy;
  }

  private randomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  private async sleep(): Promise<void> {
    if (this.intervalMin > 0 && this.intervalMax >= this.intervalMin) {
      const ms = this.intervalMin + Math.floor(Math.random() * (this.intervalMax - this.intervalMin + 1));
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }

  /** 清空 Cookie：给了 url/host 就只清那一份，否则全清（换新会话用） */
  clearCookies(urlOrHost?: string): void {
    if (!urlOrHost) {
      this.cookieJar.clear();
      return;
    }
    const host = urlOrHost.includes('://') ? this.hostOf(urlOrHost) : urlOrHost;
    this.cookieJar.delete(host);
  }

  private cookieHeader(url: string): string | undefined {
    const jar = this.cookieJar.get(this.hostOf(url));
    if (!jar || jar.size === 0) return undefined;
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** 记录响应里的 Set-Cookie；返回是否收到新 cookie（即 403 二次验证的判据） */
  private storeCookies(url: string, res: Response): boolean {
    const host = this.hostOf(url);
    if (!host) return false;

    const raw: string[] =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : res.headers.get('set-cookie')
          ? [res.headers.get('set-cookie') as string]
          : [];
    if (raw.length === 0) return false;

    let jar = this.cookieJar.get(host);
    if (!jar) {
      jar = new Map<string, string>();
      this.cookieJar.set(host, jar);
    }
    for (const line of raw) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/max-age=0\b/i.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    return true;
  }

  /**
   * GET 抓取，返回按 charset 解码后的文本。失败返回 null。
   *
   * headers 来自书源配置（bookSource.header）：很多站点校验 Referer / Cookie / Accept-Language，
   * 只给随机 UA 会被判成爬虫直接返回空页或验证码页。
   */
  async get(url: string, charset = 'utf-8', headers?: Record<string, string>): Promise<string | null> {
    return this.request('GET', url, { charset, headers });
  }

  /** POST 抓取（表单/JSON body），失败返回 null。 */
  async post(url: string, body: string, opts: { charset?: string; headers?: Record<string, string> } = {}): Promise<string | null> {
    return this.request('POST', url, { ...opts, body });
  }

  /** 统一请求入口：URL 选项解析 + cookie 会话 + 403 二次验证 + 重试 */
  private async request(
    method: 'GET' | 'POST',
    rawUrl: string,
    opts: { charset?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<string | null> {
    const { url, options } = parseUrlOptions(rawUrl);
    const charset = opts.charset ?? options.charset ?? 'utf-8';
    // 显式传入的头优先于 URL 内联选项（前者来自书源配置，更明确）
    const headers = { ...options.headers, ...opts.headers };
    const maxRetry = options.retry ?? this.retryCount;

    let retries = 0;
    let cookieRetries = 0;

    for (;;) {
      if (retries > 0 || cookieRetries > 0) await this.sleep();
      const res = await this.fetchOnce(method, url, { charset, headers, body: opts.body, timeout: options.timeout });

      if (res === null) {
        if (retries >= maxRetry) return null;
        retries += 1;
        continue;
      }

      // 403 + 新 cookie：典型的「首击验证」，立刻带上 cookie 再来一次
      if (!res.ok && res.setCookie && cookieRetries < MAX_COOKIE_RETRIES) {
        cookieRetries += 1;
        continue;
      }

      if (res.ok && res.body !== null && res.body.length >= MIN_BODY_LENGTH) return res.body;

      // 200 但页面过短（限频提示页/空壳），或非 403 的失败：按普通重试处理
      if (retries >= maxRetry) return res.body && res.body.length > 0 ? res.body : null;
      retries += 1;
    }
  }

  private async fetchOnce(
    method: 'GET' | 'POST',
    url: string,
    opts: { charset: string; headers?: Record<string, string>; body?: string; timeout?: number },
  ): Promise<{ ok: boolean; body: string | null; setCookie: boolean } | null> {
    const res = await this.fetchDetailed(method, url, opts);
    // status=0 表示请求根本没到达，调用方（request）据此决定是否重试
    if (res.status === 0) return null;
    return { ok: res.ok, body: res.body, setCookie: res.setCookie };
  }

  /**
   * 单次请求的完整结果（不重试、不吞异常原因）。
   *
   * 与 fetchOnce 的区别：这个版本把状态码、最终地址、错误文本都带出来，
   * 供 probe（可达性探测）如实上报。采集路径不需要这些，所以由 fetchOnce 包一层丢掉。
   */
  private async fetchDetailed(
    method: 'GET' | 'POST',
    url: string,
    opts: { charset: string; headers?: Record<string, string>; body?: string; timeout?: number },
  ): Promise<{
    ok: boolean;
    status: number;
    finalUrl: string;
    contentType?: string;
    body: string | null;
    /** 原始字节：probe 在编码猜错时要重新解码（采集路径有显式 charset，由 fetchOnce 丢掉） */
    buffer?: Buffer;
    bodyBytes: number;
    setCookie: boolean;
    error?: string;
  }> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': this.randomUserAgent(),
        ...opts.headers,
      };
      const cookie = this.cookieHeader(url);
      if (cookie) headers['Cookie'] = cookie;

      const init: RequestInit = {
        method,
        headers,
        redirect: 'follow',
        signal: opts.timeout ? AbortSignal.timeout(opts.timeout) : undefined,
      };
      if (method === 'POST' && opts.body !== undefined) init.body = opts.body;

      const res = await fetch(url, init);

      const setCookie = this.storeCookies(url, res);
      const finalUrl = res.url || url;
      const contentType = res.headers.get('content-type') ?? undefined;

      if (!res.ok) {
        return { ok: false, status: res.status, finalUrl, contentType, body: null, bodyBytes: 0, setCookie };
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        ok: true,
        status: res.status,
        finalUrl,
        contentType,
        body: decode(buffer, opts.charset),
        buffer,
        bodyBytes: buffer.byteLength,
        setCookie,
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        finalUrl: url,
        body: null,
        bodyBytes: 0,
        setCookie: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * 站点可达性探测：判断「这个地址现在能不能打开」。
   *
   * 与 get() 的取舍正好相反：get 为采集服务（失败重试、短页面判失败、只回正文），
   * probe 为**人工判断**服务——一次请求、如实上报状态码/耗时/最终地址/标题，
   * 不因为页面短就重试，否则管理员永远看不到「站点返回了 200 但只有 30 字节的验证码页」。
   *
   * 但 cookie 会话是例外：403 + Set-Cookie 属于站点级二次验证，
   * 采集路径会自动带 cookie 重发，探测也必须走同一套，否则会出现「测试说打不开、采集却正常」。
   */
  async probe(
    rawUrl: string,
    opts: { charset?: string; headers?: Record<string, string>; timeout?: number } = {},
  ): Promise<SiteProbeResult> {
    const { url, options } = parseUrlOptions(rawUrl);
    // 「显式指定」= 调用方传了，或书源地址里内联了 charset。两者都没有才去嗅探
    const explicitCharset = opts.charset ?? options.charset;
    const initialCharset = explicitCharset ?? 'utf-8';
    const headers = { ...options.headers, ...opts.headers };
    const timeout = opts.timeout ?? options.timeout ?? PROBE_TIMEOUT_MS;
    const startedAt = Date.now();

    let res = await this.fetchDetailed('GET', url, { charset: initialCharset, headers, timeout });
    let cookieRetried: boolean | undefined;

    if (!res.ok && res.setCookie) {
      const retry = await this.fetchDetailed('GET', url, { charset: initialCharset, headers, timeout });
      cookieRetried = retry.ok;
      res = retry;
    }

    /**
     * 没给出编码时按响应头/meta 修正一次。
     *
     * 批量测试只能拿到书源名与地址（列表接口不带 json 配置里的 charset），
     * 不修正就会把 GBK 站点的标题报成乱码——看起来像站点坏了，其实是探测解错了码。
     */
    let charset = initialCharset;
    let body = res.body;
    if (!explicitCharset && res.body !== null && res.buffer) {
      const sniffed = sniffCharset(res.body, res.contentType);
      if (sniffed && sniffed !== initialCharset) {
        charset = sniffed;
        body = decode(res.buffer, sniffed);
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      costMs: Date.now() - startedAt,
      finalUrl: res.finalUrl,
      contentType: res.contentType,
      bodyBytes: res.bodyBytes,
      charset,
      title: body ? extractTitle(body) : undefined,
      cookieRetried,
      error: res.error,
    };
  }
}

/**
 * 从响应头或 HTML 头部嗅探编码。
 *
 * 为什么「先按 utf-8 解一遍再嗅探」是可行的：`<meta charset="gbk">` 这段声明本身是纯 ASCII，
 * 用 utf-8 解码仍然正确，只有正文会乱码。所以拿解码结果找声明、再用声明的编码重读一遍即可，
 * 不需要额外依赖，也不用先猜字节序。
 */
function sniffCharset(html: string, contentType?: string): string | undefined {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (fromHeader) return normalizeCharset(fromHeader);

  // 只看前 4KB：charset 声明必须在文档头部，通读整页没有意义
  const head = html.slice(0, 4096);
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  return fromMeta ? normalizeCharset(fromMeta) : undefined;
}

/** gb2312 / gb_2312-80 统一按 gbk 解：GBK 是 GB2312 的超集，用超集解码不会丢字 */
function normalizeCharset(value: string): string {
  const cs = value.toLowerCase();
  return cs === 'gb2312' || cs === 'gb_2312-80' ? 'gbk' : cs;
}

/** 从 HTML 里取 <title>；取不到就 undefined（不是空串，前端好判断） */
function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return undefined;
  const title = match[1].replace(/\s+/g, ' ').trim();
  return title === '' ? undefined : title.slice(0, 200);
}

/** 按 charset 解码（Node 内置 TextDecoder 支持 gbk/gb2312/big5 等） */
function decode(buffer: Buffer, charset: string): string {
  const cs = (charset || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(cs === 'utf8' ? 'utf-8' : cs).decode(buffer);
  } catch {
    // 未知编码回退 utf-8
    return buffer.toString('utf8');
  }
}

export const httpClient = new HttpClient();
