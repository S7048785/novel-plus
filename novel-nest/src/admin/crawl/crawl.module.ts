import { Module } from '@nestjs/common';
import { CrawlController } from './controller/crawl.controller.js';
import { BookSourceController } from './controller/book-source.controller.js';
import { CrawlService } from './service/crawl.service.js';
import { BookSourceService } from './service/book-source.service.js';
import { HttpClient } from './crawler/http-client.js';
import { RepositoryModule } from '../../common/repo/repository.module.js';

/**
 * 采集模块：书源配置 CRUD + 规则解析 + 抓取 + 落库编排。
 *
 * 数据访问全部来自 RepositoryModule，本模块不持有也不导出任何 repo。
 */
@Module({
  imports: [RepositoryModule],
  controllers: [CrawlController, BookSourceController],
  providers: [
    /**
     * 采集间隔从 .env 读（CRAWL_INTERVAL_MIN/MAX），而不是写死默认值。
     * 理由：不同站点能承受的频率差一个数量级——本地小站 300ms 没事，
     * 有风控的站（如 xsbook）8 秒才安全。写死会让「改配置」变成「改代码」。
     */
    {
      provide: HttpClient,
      useFactory: () =>
        new HttpClient({
          intervalMin: Number(process.env.CRAWL_INTERVAL_MIN ?? 300),
          intervalMax: Number(process.env.CRAWL_INTERVAL_MAX ?? 500),
          retryCount: Number(process.env.CRAWL_RETRY_COUNT ?? 3),
        }),
    },
    CrawlService,
    BookSourceService,
  ],
  exports: [CrawlService, BookSourceService],
})
export class CrawlModule {}
