import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserService } from '../service/user.service.js';
import { Roles } from '../../../auth/roles.decorator.js';
import { CurrentUser } from '../../../auth/current-user.decorator.js';
import type { Viewer } from '../../../common/authz/role.js';
import { ApiZodCreated, ApiZodOk } from '../../../common/dto/openapi.js';
import {
  batchDeleteUserSchema,
  createUserSchema,
  updateUserSchema,
  userBatchDeleteResponseSchema,
  userDeleteResponseSchema,
  userIdResponseSchema,
  userListResponseSchema,
  userSummarySchema,
  type BatchDeleteUserInput,
  type CreateUserInput,
  type UpdateUserInput,
} from '@novel-plus/shared/dto';
import { userIdParamsSchema, type UserIdParams } from '../dto/user.params.schema.js';
import { listUserQuerySchema, type ListUserQuery } from '../dto/user.query.schema.js';

/**
 * 用户后台管理（`/api/admin/users`）：账号 CRUD + 身份授予。
 *
 * 用复数 users 而不是单数：AuthController 已经占了 `/user`（`GET /user/me`，那是「当前登录者」），
 * 这里管的是「所有账号」，两者不是一个资源。加上 /admin 前缀后本可以合并命名，
 * 但保持复数能让「我」与「用户列表」在语义上继续分开。
 *
 * 前缀 /admin 与 `src/admin/` 目录对齐：这一层都是管理员专用接口。
 * 整个 controller 限管理员——能改身份就能给自己加权限，是权限系统里最敏感的一组接口。
 */
@Roles('admin')
@Controller('admin/users')
export class UserController {
  constructor(private readonly service: UserService) {}

  /** 分页列表，支持昵称/邮箱关键字与身份筛选 */
  @Get()
  @ApiZodOk(userListResponseSchema)
  list(@Query({ schema: listUserQuerySchema }) query: ListUserQuery) {
    return this.service.list(query);
  }

  /** 用户详情 */
  @Get(':id')
  @ApiZodOk(userSummarySchema)
  get(@Param({ schema: userIdParamsSchema }) params: UserIdParams) {
    return this.service.get(params.id);
  }

  /** 新增用户（邮箱 + 密码 + 昵称 + 可选身份），密码用 better-auth 的 scrypt 哈希落库 */
  @Post()
  @ApiZodCreated(userIdResponseSchema)
  create(@Body({ schema: createUserSchema }) body: CreateUserInput) {
    return this.service.create(body);
  }

  /** 部分更新昵称/邮箱/头像/身份（image 传 null 清空；roles 整体替换） */
  @Patch(':id')
  @ApiZodOk(userIdResponseSchema)
  patch(
    @Param({ schema: userIdParamsSchema }) params: UserIdParams,
    @Body({ schema: updateUserSchema }) body: UpdateUserInput,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.patch(params.id, body, viewer.id);
  }

  /** 删除用户（会话、登录凭据与身份一并清理，不可恢复） */
  @Delete(':id')
  @ApiZodOk(userDeleteResponseSchema)
  remove(@Param({ schema: userIdParamsSchema }) params: UserIdParams, @CurrentUser() viewer: Viewer) {
    return this.service.remove(params.id, viewer.id);
  }

  /** 批量删除用户 */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  @ApiZodOk(userBatchDeleteResponseSchema)
  removeMany(
    @Body({ schema: batchDeleteUserSchema }) body: BatchDeleteUserInput,
    @CurrentUser() viewer: Viewer,
  ) {
    return this.service.removeMany(body.ids, viewer.id);
  }
}
