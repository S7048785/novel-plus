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
      if (!res.ok) return { ok: false, body: null, setCookie };

      const buffer = Buffer.from(await res.arrayBuffer());
      return { ok: true, body: decode(buffer, opts.charset), setCookie };
    } catch {
      return null;
    }
  }
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
