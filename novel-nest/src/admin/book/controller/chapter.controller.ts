import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { BookChapterService } from '../service/chapter.service.js';
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
 * 章节后台管理。
 *
 * 路由挂在书下面（/book/:bookId/chapter）：章节脱离书没有意义，
 * 这样 URL 本身就带上了归属关系，也不会和 BookController 的 /book/:id 冲突
 * （层级不同，Nest 不会把 15/chapter 当成 id）。
 */
@Controller('book/:bookId/chapter')
export class BookChapterController {
  constructor(private readonly service: BookChapterService) {}

  /** 目录列表（不含正文，带正文字数），按章节顺序 index 升序 */
  @Get()
  @ApiZodOk(chapterListResponseSchema)
  list(@Param({ schema: bookIdParamsSchema }) params: BookIdParams, @Query({ schema: listChapterQuerySchema }) query: ListChapterQuery) {
    return this.service.list(params.bookId, query);
  }

  /** 章节详情（含正文） */
  @Get(':chapterId')
  @ApiZodOk(chapterDetailSchema)
  get(@Param({ schema: chapterParamsSchema }) params: ChapterParams) {
    return this.service.get(params.bookId, params.chapterId);
  }

  /** 新增章节；index 不传则自动追加到目录末尾 */
  @Post()
  @ApiZodCreated(idResponseSchema)
  create(@Param({ schema: bookIdParamsSchema }) params: BookIdParams, @Body({ schema: createChapterSchema }) body: CreateChapterInput) {
    return this.service.create(params.bookId, body);
  }

  /** 更新章节（PATCH）：content 传 null 或空串表示删除正文 */
  @Patch(':chapterId')
  @ApiZodOk(idResponseSchema)
  update(@Param({ schema: chapterParamsSchema }) params: ChapterParams, @Body({ schema: updateChapterSchema }) body: UpdateChapterInput) {
    return this.service.update(params.bookId, params.chapterId, body);
  }

  /** 删除章节（正文级联删除） */
  @Delete(':chapterId')
  @ApiZodOk(deleteResponseSchema)
  remove(@Param({ schema: chapterParamsSchema }) params: ChapterParams) {
    return this.service.remove(params.bookId, params.chapterId);
  }

  /** 批量删除章节（只在本书范围内生效） */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  @ApiZodOk(batchDeleteResponseSchema)
  removeMany(
    @Param({ schema: bookIdParamsSchema }) params: BookIdParams,
    @Body({ schema: batchDeleteChapterSchema }) body: BatchDeleteChapterInput,
  ) {
    return this.service.removeMany(params.bookId, body.ids);
  }
}
