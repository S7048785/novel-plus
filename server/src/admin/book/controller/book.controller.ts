import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { BookService } from '../service/book.service.js';
import { idParamsSchema, type IdParams } from '../../../common/dto/common.schema.js';
import { Roles } from '../../../auth/roles.decorator.js';
import {
  batchDeleteBookSchema,
  bookMetadataPatchSchema,
  bookMetadataSchema,
  createBookSchema,
  type BatchDeleteBookInput,
  type BookMetadataInput,
  type BookMetadataPatch,
  type CreateBookInput,
} from '../dto/book.payload.schema.js';
import { listBookQuerySchema, type ListBookQuery } from '../dto/book.query.schema.js';
import { bookListResponseSchema, bookSummarySchema } from '../dto/book.response.schema.js';
import {
  batchDeleteResponseSchema,
  deleteResponseSchema,
  idResponseSchema,
} from '../../../common/dto/common.response.schema.js';
import { ApiZodCreated, ApiZodOk } from '../../../common/dto/openapi.js';

/**
 * 书籍后台管理（`/api/admin/book`）。
 *
 * 路径用 /admin/book 而非 /admin/crawl/book：/admin/crawl/book 已被「采集一本书」占用（POST），
 * 且这里的语义是管理已入库的书籍，不该混进采集命名空间。
 *
 * 前缀 /admin 是这一层目录的约定：`src/admin/` 下的 controller 都是**管理员专用**，
 * URL 与之对齐，方便一眼看出「这是运营端接口」。作家端将来放在 `src/author/`，走 /author 前缀。
 *
 * 入库方式（crawl / author / manual）用 body 里的 origin 表达，见 common/book/origin.ts；
 * 它记录「书是怎么进来的」，与书源（source_id，「从哪个站点采集」）是两个维度。
 *
 * @ApiZodOk / @ApiZodCreated 只负责「响应长什么样」——入参校验与文档由参数装饰器上的
 * zod schema 自动完成，两者配合才能让 Swagger 与前端 codegen 拿到完整契约。
 */
@Roles('admin')
@Controller('admin/book')
export class BookController {
  constructor(private readonly service: BookService) {}

  /** 分页列表（含书源名与已采集章节数），支持书名/作者关键字、书源与入库方式筛选 */
  @Get()
  @ApiZodOk(bookListResponseSchema)
  list(@Query({ schema: listBookQuerySchema }) query: ListBookQuery) {
    return this.service.list(query);
  }

  /** 书籍详情 */
  @Get(':id')
  @ApiZodOk(bookSummarySchema)
  get(@Param({ schema: idParamsSchema }) params: IdParams) {
    return this.service.get(params.id);
  }

  /** 手动新增书籍（正常情况下书籍由采集写入） */
  @Post()
  @ApiZodCreated(idResponseSchema)
  create(@Body({ schema: createBookSchema }) body: CreateBookInput) {
    return this.service.create(body);
  }

  /** 全量覆盖元数据（PUT）——未传的元数据字段会被置 null，只想改个别字段用 PATCH */
  @Put(':id')
  @ApiZodOk(idResponseSchema)
  replace(
    @Param({ schema: idParamsSchema }) params: IdParams,
    @Body({ schema: bookMetadataSchema }) body: BookMetadataInput,
  ) {
    return this.service.replace(params.id, body);
  }

  /** 部分更新元数据（PATCH）——只改传入字段，传 null 表示清空 */
  @Patch(':id')
  @ApiZodOk(idResponseSchema)
  patch(
    @Param({ schema: idParamsSchema }) params: IdParams,
    @Body({ schema: bookMetadataPatchSchema }) body: BookMetadataPatch,
  ) {
    return this.service.patch(params.id, body);
  }

  /** 删除书籍（章节与正文一并删除，不可恢复） */
  @Delete(':id')
  @ApiZodOk(deleteResponseSchema)
  remove(@Param({ schema: idParamsSchema }) params: IdParams) {
    return this.service.remove(params.id);
  }

  /** 批量删除书籍 */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  @ApiZodOk(batchDeleteResponseSchema)
  removeMany(@Body({ schema: batchDeleteBookSchema }) body: BatchDeleteBookInput) {
    return this.service.removeMany(body.ids);
  }
}
