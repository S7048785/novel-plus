import { Module } from '@nestjs/common';
import { CrawlModule } from './crawl/crawl.module.js';
import { BookModule } from './book/book.module.js';

/**
 * 后台管理入口模块。
 *
 * 收纳所有面向管理端的接口：采集与书源（crawl）、书籍（book）。
 * 应用层只需要 import 这一个模块，不必关心后台内部拆了几个子模块。
 */
@Module({
  imports: [CrawlModule, BookModule],
})
export class AdminModule {}
