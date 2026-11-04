import { describe, it, expect } from 'vitest';
import { dedupeChaptersByUrl } from './crawl.service.js';
import { parseUrlOptions } from '../crawler/http-client.js';

describe('dedupeChaptersByUrl', () => {
  it('保留最后一次出现的位置（最新 N 条 + 完整目录）', () => {
    const input = [
      { url: '/c/3', title: '第3章' },
      { url: '/c/2', title: '第2章' },
      { url: '/c/1', title: '第1章' },
      { url: '/c/2', title: '第2章' },
      { url: '/c/3', title: '第3章' },
    ];
    expect(dedupeChaptersByUrl(input).map((c) => c.url)).toEqual(['/c/1', '/c/2', '/c/3']);
  });

  it('无重复时保持原序', () => {
    const input = [{ url: '/c/1' }, { url: '/c/2' }];
    expect(dedupeChaptersByUrl(input).map((c) => c.url)).toEqual(['/c/1', '/c/2']);
  });
});

describe('parseUrlOptions', () => {
  it('拆出 retry 选项', () => {
    const r = parseUrlOptions('http://a.com/x,{"retry":2}');
    expect(r.url).toBe('http://a.com/x');
    expect(r.options.retry).toBe(2);
  });

  it('URL 自带逗号但不带 JSON 时原样保留', () => {
    const r = parseUrlOptions('http://a.com/x?a=1,2');
    expect(r.url).toBe('http://a.com/x?a=1,2');
    expect(r.options).toEqual({});
  });

  it('JSON 非法时整体当 URL', () => {
    const r = parseUrlOptions('http://a.com/x,{oops}');
    expect(r.url).toBe('http://a.com/x,{oops}');
  });
});
