import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { BookService } from '../service/book.service.js';
import { idParamsSchema, type IdParams } from '../../../common/dto/common.schema.js';
import { Roles } from '../../../auth/roles.decorator.js';
import { CurrentUser } from '../../../auth/current-user.decorator.js';
import type { Viewer } from '../../../common/authz/role.js';
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
 * 路径用 /admin/book 而非 /crawl/book：/admin/crawl/book 已被「采集一本书」占用（POST），
 * 且这里的语义是管理已入库的书籍，不该混进采集命名空间。
 *
 * 前缀 /admin 是这一层目录的约定：`src/admin/` 下的所有 controller 都是**管理员专用**，
 * URL 与之对齐，方便一眼看出「这是运营端接口」。作家端将来放在 `src/author/`，走 /author 前缀，
 * 复用同一批 service 但只放行自己的数据（service 里的归属判断已经预留了 viewer 参数）。
 *
 * 这个 controller 里 viewer 目前恒为管理员，owner 相关的分支走的是「管理员看全部」那一侧；
 * 保留 viewer 参数是为了作家端接进来时不用改 service 签名。
 *
 * @ApiZodOk / @ApiZodCreated 只负责「响应长什么样」——入参校验与文档由参数装饰器上的
 * zod schema 自动完成，两者配合才能让 Swagger 与前端 codegen 拿到完整契约。
 */
@Roles('admin')
@Controller('admin/book')
export class BookController {
  constructor(private readonly service: BookService) {}

  /** 分页列表（含书源名与已采集章节数），支持书名/作者关键字、书源筛选；作家只看自己的书 */
  @Get()
  @ApiZodOk(bookListResponseSchema)
  list(@Query({ schema: listBookQuerySchema }) query: ListBookQuery, @CurrentUser() viewer: Viewer) {
    return this.service.list(query, viewer);
  }

  /** 书籍详情 */
  @Get(':id')
  @ApiZodOk(bookSummarySchema)
  get(@Param({ schema: idParamsSchema }) params: IdParams, @CurrentUser() viewer: Viewer) {
    return this.service.get(params.id, viewer);
  }

  /** 手动新增书籍（正常情况下书籍由采集写入）；作家新建的书自动归自己 */
  @Post()
  @ApiZodCreated(idResponseSchema)
  create(@Body({ schema: createBookSchema }) body: CreateBookInput, @CurrentUser() viewer: Viewer) {
    return this.service.create(body, viewer);
  }

  /** 全量覆盖元数据（PUT）——未传的元数据字段会被置 null，只想改个别字段用 PATCH */
  @Put(':id')
  @ApiZodOk(idResponseSchema)
  replace(
    @Param({ schema: idParamsSchema }) params: IdParams,
    @Body({ schema: bookMetadataSchema }) body: BookMetadataInput,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.replace(params.id, body, viewer);
  }

  /** 部分更新元数据（PATCH）——只改传入字段，传 null 表示清空 */
  @Patch(':id')
  @ApiZodOk(idResponseSchema)
  patch(
    @Param({ schema: idParamsSchema }) params: IdParams,
    @Body({ schema: bookMetadataPatchSchema }) body: BookMetadataPatch,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.patch(params.id, body, viewer);
  }

  /** 删除书籍（章节与正文一并删除，不可恢复） */
  @Delete(':id')
  @ApiZodOk(deleteResponseSchema)
  remove(@Param({ schema: idParamsSchema }) params: IdParams, @CurrentUser() viewer: Viewer) {
    return this.service.remove(params.id, viewer);
  }

  /** 批量删除书籍 */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  @ApiZodOk(batchDeleteResponseSchema)
  removeMany(
    @Body({ schema: batchDeleteBookSchema }) body: BatchDeleteBookInput,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.removeMany(body.ids, viewer);
  }
}
