import { Module } from '@nestjs/common';
import { BookController } from './controller/book.controller.js';
import { BookChapterController } from './controller/chapter.controller.js';
import { BookService } from './service/book.service.js';
import { BookChapterService } from './service/chapter.service.js';
import { RepositoryModule } from '../../common/repo/repository.module.js';

/**
 * 书籍管理模块（后台）：书籍 CRUD + 章节目录 CRUD。
 *
 * 只依赖 RepositoryModule 取数据，不依赖 CrawlModule——两个功能模块是平级关系。
 */
@Module({
  imports: [RepositoryModule],
  controllers: [BookController, BookChapterController],
  providers: [BookService, BookChapterService],
  exports: [BookService, BookChapterService],
})
export class BookModule {}
