import { describe, it, expect } from 'vitest';
import { CrawlService } from './crawl.service.js';
import type { HttpClient } from '../crawler/http-client.js';
import type { CrawlSourceRepository } from '../../../common/repo/crawl-source.repo.js';
import type { BookRepository } from '../../../common/repo/book.repo.js';
import type { BookChapterRepository } from '../../../common/repo/book-chapter.repo.js';
import type { BookSource } from '../../../common/model/book-source.js';

/**
 * 采集编排的最小可测面：书源 header 是否真的透传到 HTTP 请求上。
 *
 * 这里用桩替掉 HttpClient 与 repo，只验证编排层的「传参」，
 * 不关心真实网络与数据库——那部分由 parser 的单测和真实站点手动验证覆盖。
 */
function buildService(source: Partial<BookSource>) {
  const calls: { url: string; charset?: string; headers?: Record<string, string> }[] = [];
  const http = {
    get: async (url: string, charset?: string, headers?: Record<string, string>) => {
      calls.push({ url, charset, headers });
      return '<html><body><h1>书一</h1></body></html>';
    },
    post: async () => null,
  } as unknown as HttpClient;

  const fullSource = {
    bookSourceName: '测试源',
    bookSourceUrl: 'https://x.com',
    charset: 'utf-8',
    ruleBookInfo: { name: 'h1@text' },
    ...source,
  } as BookSource;

  const crawlSourceRepo = {
    findById: async () => fullSource,
    findAllFull: async () => [fullSource],
  } as unknown as CrawlSourceRepository;
  const bookRepo = { findByBookUrl: async () => null } as unknown as BookRepository;
  const chapterRepo = {} as unknown as BookChapterRepository;

  return { service: new CrawlService(http, crawlSourceRepo, bookRepo, chapterRepo), calls };
}

describe('CrawlService - 书源 header 透传', () => {
  it('详情页请求带上书源自定义 header', async () => {
    const { service, calls } = buildService({
      header: JSON.stringify({ Referer: 'https://x.com/list', 'Accept-Language': 'zh-CN' }),
    });

    await service.getBookDetail('https://x.com/1.html');

    expect(calls).toHaveLength(1);
    expect(calls[0].headers).toEqual({ Referer: 'https://x.com/list', 'Accept-Language': 'zh-CN' });
  });

  it('header 非法 JSON 时降级为空对象，不抛错', async () => {
    const { service, calls } = buildService({ header: '不是 JSON' });

    await service.getBookDetail('https://x.com/1.html');

    expect(calls[0].headers).toEqual({});
  });

  it('未配置 header 时不带自定义头', async () => {
    const { service, calls } = buildService({});

    await service.getBookDetail('https://x.com/1.html');

    expect(calls[0].headers).toEqual({});
  });
});
