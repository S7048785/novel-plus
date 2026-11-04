import { describe, it, expect } from 'vitest';
import { evalJs } from './js.js';

describe('JS 引擎', () => {
  it('js: 基本求值', async () => {
    expect(await evalJs('1+1')).toBe('2');
  });

  it('input / result 变量', async () => {
    expect(await evalJs('input + "!"', { input: 'hello' })).toBe('hello!');
    expect(await evalJs('result', { input: 'abc' })).toBe('abc');
  });

  it('baseUrl 变量', async () => {
    expect(await evalJs('baseUrl', { baseUrl: 'https://x.com' })).toBe('https://x.com');
  });

  it('java.md5Encode', async () => {
    expect(await evalJs('java.md5Encode("abc")')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('java.base64Encode/Decode', async () => {
    expect(await evalJs('java.base64Encode("hello")')).toBe('aGVsbG8=');
    expect(await evalJs('java.base64Decode("aGVsbG8=")')).toBe('hello');
  });

  it('java.timeFormat', async () => {
    // 1609459200 = 2021-01-01 00:00:00 UTC+8
    const r = await evalJs('java.timeFormat(1609459200)');
    expect(r).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('java.encodeURIComponent', async () => {
    expect(await evalJs('java.encodeURIComponent("a b")')).toBe('a%20b');
  });

  it('java.uuid / now', async () => {
    expect((await evalJs('java.uuid()')).length).toBe(36);
    expect(Number(await evalJs('java.now()'))).toBeGreaterThan(1700000000000);
  });

  it('正则后处理 input.replace', async () => {
    expect(await evalJs('input.replace(/^作者[:：]?/, "").trim()', { input: '作者：天蚕土豆' })).toBe('天蚕土豆');
  });

  it('返回数组自动 JSON 序列化', async () => {
    const r = await evalJs('[1,2,3]');
    expect(JSON.parse(r)).toEqual([1, 2, 3]);
  });

  it('cache 内存 KV', async () => {
    await evalJs('cache.put("k", "v")');
    expect(await evalJs('cache.get("k")')).toBe('v');
  });

  it('错误 JS 返回空', async () => {
    expect(await evalJs('not.defined.var')).toBe('');
  });
});
