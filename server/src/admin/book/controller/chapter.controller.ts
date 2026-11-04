import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { BookChapterService } from '../service/chapter.service.js';
import { Roles } from '../../../auth/roles.decorator.js';
import { CurrentUser } from '../../../auth/current-user.decorator.js';
import type { Viewer } from '../../../common/authz/role.js';
import {
  batchDeleteChapterSchema,
  bookIdParamsSchema,
  chapterParamsSchema,
  createChapterSchema,
  listChapterQuerySchema,
  updateChapterSchema,
  type BatchDeleteChapterInput,
  type BookIdParams,
  type ChapterParams,
  type CreateChapterInput,
  type ListChapterQuery,
  type UpdateChapterInput,
} from '../dto/chapter.schema.js';
import {
  chapterDetailSchema,
  chapterListResponseSchema,
} from '../dto/chapter.response.schema.js';
import {
  batchDeleteResponseSchema,
  deleteResponseSchema,
  idResponseSchema,
} from '../../../common/dto/common.response.schema.js';
import { ApiZodCreated, ApiZodOk } from '../../../common/dto/openapi.js';

/**
 * 章节后台管理（`/api/admin/book/:bookId/chapter`）。
 *
 * 路由挂在书下面：章节脱离书没有意义，这样 URL 本身就带上了归属关系，
 * 也不会和 BookController 的 /admin/book/:id 冲突（层级不同，Nest 不会把 15/chapter 当成 id）。
 *
 * 身份：与书籍一致——`src/admin/` 下只允许管理员。章节没有独立归属，
 * 能改这本书的人才能改它的章节，具体校验在 service 里按 bookId 查书的归属后完成
 * （作家端接入后，同一段逻辑会按 viewer 缩小范围，这里不用改）。
 */
@Roles('admin')
@Controller('admin/book/:bookId/chapter')
export class BookChapterController {
  constructor(private readonly service: BookChapterService) {}

  /** 目录列表（不含正文，带正文字数），按章节顺序 index 升序 */
  @Get()
  @ApiZodOk(chapterListResponseSchema)
  list(
    @Param({ schema: bookIdParamsSchema }) params: BookIdParams,
    @Query({ schema: listChapterQuerySchema }) query: ListChapterQuery,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.list(params.bookId, query, viewer);
  }

  /** 章节详情（含正文） */
  @Get(':chapterId')
  @ApiZodOk(chapterDetailSchema)
  get(
    @Param({ schema: chapterParamsSchema }) params: ChapterParams,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.get(params.bookId, params.chapterId, viewer);
  }

  /** 新增章节；index 不传则自动追加到目录末尾 */
  @Post()
  @ApiZodCreated(idResponseSchema)
  create(
    @Param({ schema: bookIdParamsSchema }) params: BookIdParams,
    @Body({ schema: createChapterSchema }) body: CreateChapterInput,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.create(params.bookId, body, viewer);
  }

  /** 更新章节（PATCH）：content 传 null 或空串表示删除正文 */
  @Patch(':chapterId')
  @ApiZodOk(idResponseSchema)
  update(
    @Param({ schema: chapterParamsSchema }) params: ChapterParams,
    @Body({ schema: updateChapterSchema }) body: UpdateChapterInput,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.update(params.bookId, params.chapterId, body, viewer);
  }

  /** 删除章节（正文一并删除） */
  @Delete(':chapterId')
  @ApiZodOk(deleteResponseSchema)
  remove(
    @Param({ schema: chapterParamsSchema }) params: ChapterParams,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.remove(params.bookId, params.chapterId, viewer);
  }

  /** 批量删除章节（只在本书范围内生效） */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  @ApiZodOk(batchDeleteResponseSchema)
  removeMany(
    @Param({ schema: bookIdParamsSchema }) params: BookIdParams,
    @Body({ schema: batchDeleteChapterSchema }) body: BatchDeleteChapterInput,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.removeMany(params.bookId, body.ids, viewer);
  }
}
