import iconv from 'iconv-lite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './http-client.js';

/**
 * 站点可达性探测（probe）的行为约定。
 *
 * 这里不测真实网络：断言的是「拿到某种响应时，probe 报出来的东西对不对」。
 * 重点有三条，都是靠肉眼点页面看不出来的：
 * 1. 短页面**不能**被判成失败（采集路径会重试，探测必须如实回 ok=true + 小的 bodyBytes）；
 * 2. 403 + Set-Cookie 要自动带 cookie 重试（与采集路径同一套站点级二次验证）；
 * 3. 网络层失败要变成 status=0 + error，而不是抛异常给上层。
 */
function stubFetch(handler: () => Promise<Response>) {
  const spy = vi.fn(handler);
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** 按顺序回放响应；用完后返回 500，避免测试里出现未预期的第 N 次请求 */
function stubSequence(responses: Response[]) {
  const queue = [...responses];
  const spy = vi.fn(async () => queue.shift() ?? new Response('', { status: 500 }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function buildClient() {
  // 间隔归零：探测路径本来就不 sleep，但显式给 0 免得将来加了间隔把测试拖慢
  return new HttpClient({ intervalMin: 0, intervalMax: 0 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpClient.probe', () => {
  it('正常页面如实上报状态码、字节数、编码与标题', async () => {
    const html = `<html><head><title>七步阁</title></head><body>${'x'.repeat(3000)}</body></html>`;
    stubFetch(async () =>
      Promise.resolve(
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );

    const result = await buildClient().probe('https://example.com');

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.title).toBe('七步阁');
    expect(result.bodyBytes).toBeGreaterThan(3000);
    expect(result.contentType).toContain('text/html');
    expect(result.charset).toBe('utf-8');
    expect(result.costMs).toBeGreaterThanOrEqual(0);
  });

  it('短页面仍报 ok=true：探测不替人判断「这页正不正常」', async () => {
    stubFetch(async () =>
      Promise.resolve(
        new Response('<html><title>人机验证</title></html>', { status: 200 }),
      ),
    );

    const result = await buildClient().probe('https://example.com');

    // 关键：采集路径会因长度不足重试，探测必须如实返回（bodyBytes 小由前端提示）
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.bodyBytes).toBeLessThan(1500);
    expect(result.title).toBe('人机验证');
  });

  it('403 且下发 cookie 时，自动带 cookie 重试一次', async () => {
    const spy = stubSequence([
      new Response('', {
        status: 403,
        headers: [['set-cookie', 'cf_clearance=abc; Path=/']],
      }),
      new Response(`<html><title>正常页</title><body>${'x'.repeat(2000)}</body></html>`, {
        status: 200,
      }),
    ]);

    const result = await buildClient().probe('https://example.com');

    expect(spy).toHaveBeenCalledTimes(2);
    const retryHeaders = (spy.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Cookie).toContain('cf_clearance=abc');

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.cookieRetried).toBe(true);
  });

  it('403 但不给 cookie 时不重试，原样报 403', async () => {
    const spy = stubSequence([new Response('', { status: 403 })]);

    const result = await buildClient().probe('https://example.com');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.cookieRetried).toBeUndefined();
  });

  it('网络层失败回落成 status=0 + error，不抛异常', async () => {
    stubFetch(async () => {
      throw new Error('getaddrinfo ENOTFOUND nope.invalid');
    });

    const result = await buildClient().probe('https://nope.invalid');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain('ENOTFOUND');
    expect(result.bodyBytes).toBe(0);
  });

  it('GBK 站点按传入编码解码，标题不出乱码', async () => {
    const html = `<html><head><title>七步阁</title></head><body>${'x'.repeat(2000)}</body></html>`;
    // 用 gbk 编码出字节流：不传 charset 时解码结果会是乱码，传 gbk 才是中文
    const gbkBody = iconv.encode(html, 'gbk');
    stubFetch(async () => Promise.resolve(new Response(gbkBody, { status: 200 })));

    const result = await buildClient().probe('https://example.com', { charset: 'gbk' });

    expect(result.charset).toBe('gbk');
    expect(result.title).toBe('七步阁');
  });

  it('未指定编码时按 meta 声明自动修正，并把 gb2312 归一到 gbk', async () => {
    // 真实站点常见写法：声明 gb2312，实际是 GBK 字符集
    const html = `<html><head><meta charset="gb2312"><title>七步阁</title></head><body>${'x'.repeat(2000)}</body></html>`;
    const gbkBody = iconv.encode(html, 'gbk');
    stubFetch(async () => Promise.resolve(new Response(gbkBody, { status: 200 })));

    // 调用方不传 charset（批量测试就是这样：列表接口不带 json 里的配置）
    const result = await buildClient().probe('https://example.com');

    expect(result.charset).toBe('gbk');
    expect(result.title).toBe('七步阁');
  });

  it('显式传入的编码优先于 meta 声明', async () => {
    // 声明 gbk，但调用方明确要求 utf-8 —— 探测应当尊重调用方的判断
    const html = `<html><head><meta charset="gbk"><title>七步阁</title></head><body>${'x'.repeat(2000)}</body></html>`;
    stubFetch(async () =>
      Promise.resolve(new Response(iconv.encode(html, 'gbk'), { status: 200 })),
    );

    const result = await buildClient().probe('https://example.com', { charset: 'utf-8' });

    expect(result.charset).toBe('utf-8');
  });
});
