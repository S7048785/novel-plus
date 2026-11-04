import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { CrawlService } from '../service/crawl.service.js';
import { evalFieldOnDoc } from '../parser/rule-engine.js';
import { bookDetailQuerySchema, type BookDetailQuery } from '../dto/book-detail.schema.js';
import {
  crawlBookBodySchema,
  searchQuerySchema,
  testRuleBodySchema,
  type CrawlBookBody,
  type SearchQuery,
  type TestRuleBody,
} from '../dto/crawl.request.schema.js';
import {
  bookDetailSchema,
  crawlBookResponseSchema,
  searchResponseSchema,
  testRuleResponseSchema,
} from '../dto/crawl.response.schema.js';
import { ApiZodOk } from '../../../common/dto/openapi.js';
import { Roles } from '../../../auth/roles.decorator.js';

/**
 * 采集接口（`/api/admin/crawl`）：搜索、书籍详情、单本采集、规则试跑。
 * 书源的增删改查已拆到 BookSourceController（/admin/crawl/source）。
 *
 * 整个 controller 限管理员：采集会往库里写书与章节、并且要发外部请求，作家没有理由碰它。
 * 前缀 /admin 与 `src/admin/` 目录对齐——这一层都是运营端接口。
 */
@Roles('admin')
@Controller('admin/crawl')
export class CrawlController {
  constructor(private readonly crawlService: CrawlService) {}

  /** 搜索 */
  @Get('search')
  @ApiZodOk(searchResponseSchema)
  async search(@Query({ schema: searchQuerySchema }) query: SearchQuery) {
    const results = await this.crawlService.search(
      query.sourceId,
      query.key,
      query.page,
    );
    return { list: results };
  }

  /** 书籍详情：传书籍详情页 URL，按所属书源的 ruleBookInfo 解析（只解析，不落库） */
  @Get('book-detail')
  @ApiZodOk(bookDetailSchema)
  bookDetail(@Query({ schema: bookDetailQuerySchema }) query: BookDetailQuery) {
    return this.crawlService.getBookDetail(query.url);
  }

  /** 单本采集 */
  @Post('book')
  @ApiZodOk(crawlBookResponseSchema)
  async book(@Body({ schema: crawlBookBodySchema }) body: CrawlBookBody) {
    const result = await this.crawlService.crawlBook(
      body.sourceId,
      body.bookUrl,
      body.maxChapters
    );
    return result;
  }

  /** 测试规则（试跑，不创建资源，所以显式 200 而不是 POST 默认的 201） */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiZodOk(testRuleResponseSchema)
  async ruleTest(@Body({ schema: testRuleBodySchema }) body: TestRuleBody) {
    const ctx = {
      baseUrl: body.baseUrl ?? '',
      variables: new Map<string, string>(),
    };
    const result = await evalFieldOnDoc(body.rule, body.content, ctx);
    return { result };
  }
}
