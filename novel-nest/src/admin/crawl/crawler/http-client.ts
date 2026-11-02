/**
 * HTTP 抓取客户端（复刻 novel-crawl 的 CrawlHttpClient + reader-rust 的 fetcher）
 *
 * 能力：随机 User-Agent、编码转换（gbk 等）、失败重试、请求间隔、可选代理。
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
];

export interface HttpClientOptions {
  /** 请求间隔（毫秒），默认随机 300-500 */
  intervalMin?: number;
  intervalMax?: number;
  /** 失败重试次数，默认 3 */
  retryCount?: number;
  /** 代理 */
  proxy?: string;
}

export class HttpClient {
  private readonly intervalMin: number;
  private readonly intervalMax: number;
  private readonly retryCount: number;
  private readonly proxy?: string;
  private readonly retryState = new Map<string, number>();

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

  /**
   * GET 抓取，返回按 charset 解码后的文本。失败返回 null。
   */
  async get(url: string, charset = 'utf-8'): Promise<string | null> {
    return this.request('GET', url, { charset });
  }

  /**
   * POST 抓取（表单/JSON body），返回按 charset 解码后的文本。失败返回 null。
   */
  async post(url: string, body: string, opts: { charset?: string; headers?: Record<string, string> } = {}): Promise<string | null> {
    return this.request('POST', url, { ...opts, body });
  }

  /** 统一请求入口：GET/POST + 重试 */
  private async request(
    method: 'GET' | 'POST',
    url: string,
    opts: { charset?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<string | null> {
    await this.sleep();
    const body = await this.fetchOnce(method, url, opts);
    if (body !== null && body.length >= 1500) {
      return body;
    }
    // 重试
    const key = method + url;
    const count = (this.retryState.get(key) ?? 0) + 1;
    if (count <= this.retryCount) {
      this.retryState.set(key, count);
      return this.request(method, url, opts);
    }
    this.retryState.delete(key);
    return null;
  }

  private async fetchOnce(
    method: 'GET' | 'POST',
    url: string,
    opts: { charset?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<string | null> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': this.randomUserAgent(),
        ...(opts.headers ?? {}),
      };
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? opts.body : undefined,
        redirect: 'follow',
      });
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      return decode(buffer, opts.charset ?? 'utf-8');
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
