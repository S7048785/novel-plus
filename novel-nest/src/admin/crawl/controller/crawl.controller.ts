import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CrawlService } from '../service/crawl.service.js';
import { evalFieldOnDoc } from '../parser/rule-engine.js';
import { bookDetailQuerySchema, type BookDetailQuery } from '../dto/book-detail.schema.js';

/**
 * 采集接口：搜索、书籍详情、单本采集、规则试跑。
 * 书源的增删改查已拆到 BookSourceController（/crawl/source）。
 */
@Controller('crawl')
export class CrawlController {
  constructor(private readonly crawlService: CrawlService) {}

  /** 搜索 */
  @Get('search')
  async search(@Query('sourceId') sourceId: string, @Query('key') key: string, @Query('page') page = '1') {
    const results = await this.crawlService.search(Number(sourceId), key, Number(page));
    return { list: results };
  }

  /** 书籍详情：传书籍详情页 URL，按所属书源的 ruleBookInfo 解析（只解析，不落库） */
  @Get('book-detail')
  bookDetail(@Query({ schema: bookDetailQuerySchema }) query: BookDetailQuery) {
    return this.crawlService.getBookDetail(query.url);
  }

  /** 单本采集 */
  @Post('book')
  async crawlBook(@Body() body: { sourceId: number; bookUrl: string }) {
    const result = await this.crawlService.crawlBook(body.sourceId, body.bookUrl);
    return result;
  }

  /** 测试规则 */
  @Post('test')
  async testRule(@Body() body: { rule: string; content: string; baseUrl?: string }) {
    const ctx = { baseUrl: body.baseUrl ?? '', variables: new Map<string, string>() };
    const result = await evalFieldOnDoc(body.rule, body.content, ctx);
    return { result };
  }
}
