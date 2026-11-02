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
  providers: [CrawlService, BookSourceService, HttpClient],
  exports: [CrawlService, BookSourceService],
})
export class CrawlModule {}
