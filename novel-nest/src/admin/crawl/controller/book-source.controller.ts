import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { BookSourceService } from '../service/book-source.service.js';
import {
  batchDeleteSchema,
  bookSourcePatchSchema,
  bookSourceSchema,
  idParamsSchema,
  listSourceQuerySchema,
  testSourceSchema,
  type BatchDeleteInput,
  type BookSourceInput,
  type BookSourcePatch,
  type ListSourceQuery,
  type TestSourceInput,
} from '../dto/book-source.schema.js';
import {
  bookSourceDetailSchema,
  bookSourceListResponseSchema,
  sourceTestResponseSchema,
} from '../dto/book-source.response.schema.js';
import {
  batchDeleteResponseSchema,
  deleteResponseSchema,
  idResponseSchema,
} from '../../../common/dto/common.response.schema.js';
import { ApiZodCreated, ApiZodOk } from '../../../common/dto/openapi.js';

type IdParams = { id: number };

/**
 * 书源 CRUD。
 *
 * 参数校验用 Nest 12 内置的 StandardSchemaValidationPipe（全局注册，见 main.ts）：
 * schema 挂在参数装饰器上，校验不过直接 400，不需要 controller 里写判断。
 */
@Controller('crawl/source')
export class BookSourceController {
  constructor(private readonly service: BookSourceService) {}

  /** 书源列表（不含规则体），支持按名称/地址关键字与启用状态筛选 */
  @Get()
  @ApiZodOk(bookSourceListResponseSchema)
  async list(@Query({ schema: listSourceQuerySchema }) query: ListSourceQuery) {
    const list = await this.service.list(query);
    return { list, total: list.length };
  }

  /** 书源详情（含完整规则体） */
  @Get(':id')
  @ApiZodOk(bookSourceDetailSchema)
  get(@Param({ schema: idParamsSchema }) params: IdParams) {
    return this.service.get(params.id);
  }

  /** 新增书源 */
  @Post()
  @ApiZodCreated(idResponseSchema)
  create(@Body({ schema: bookSourceSchema }) body: BookSourceInput) {
    return this.service.create(body);
  }

  /** 全量覆盖书源配置（PUT）——未携带的字段会被清空，只想改个别字段用 PATCH */
  @Put(':id')
  @ApiZodOk(idResponseSchema)
  replace(@Param({ schema: idParamsSchema }) params: IdParams, @Body({ schema: bookSourceSchema }) body: BookSourceInput) {
    return this.service.replace(params.id, body);
  }

  /** 部分更新书源（PATCH）——只覆盖请求里出现的字段，规则体不受影响 */
  @Patch(':id')
  @ApiZodOk(idResponseSchema)
  patch(@Param({ schema: idParamsSchema }) params: IdParams, @Body({ schema: bookSourcePatchSchema }) body: BookSourcePatch) {
    return this.service.patch(params.id, body);
  }

  /** 删除书源（已采集的书籍保留，不级联删除） */
  @Delete(':id')
  @ApiZodOk(deleteResponseSchema)
  remove(@Param({ schema: idParamsSchema }) params: IdParams) {
    return this.service.remove(params.id);
  }

  /** 批量删除书源（POST 默认 201，这里显式 200：不是创建资源） */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  @ApiZodOk(batchDeleteResponseSchema)
  removeMany(@Body({ schema: batchDeleteSchema }) body: BatchDeleteInput) {
    return this.service.removeMany(body.ids);
  }

  /** 测试书源：用关键词跑一次搜索，返回命中结果与耗时 */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiZodOk(sourceTestResponseSchema)
  test(@Param({ schema: idParamsSchema }) params: IdParams, @Body({ schema: testSourceSchema }) body: TestSourceInput) {
    return this.service.test(params.id, body.key, body.page);
  }
}
