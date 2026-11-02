import { Module } from '@nestjs/common';
import { CrawlSourceRepository } from './crawl-source.repo.js';
import { BookRepository } from './book.repo.js';
import { BookChapterRepository } from './book-chapter.repo.js';

/**
 * 数据访问模块：全项目所有 Repository 的唯一注册处。
 *
 * 设计原则：repo 属于数据层，不是某个业务模块的私有资产。业务模块（crawl、book）
 * 都依赖这一层，彼此之间不需要互相 import——「导入其他模块的 repo」这种情况根本不存在。
 *
 * 依赖图（无环）：
 *   CrawlModule ──┐
 *                 ├──→ RepositoryModule ──→ DatabaseModule(global)
 *   BookModule  ──┘
 */
@Module({
  providers: [CrawlSourceRepository, BookRepository, BookChapterRepository],
  exports: [CrawlSourceRepository, BookRepository, BookChapterRepository],
})
export class RepositoryModule {}
