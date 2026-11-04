import { Module } from '@nestjs/common';
import { UserController } from './controller/user.controller.js';
import { UserService } from './service/user.service.js';
import { RepositoryModule } from '../../common/repo/repository.module.js';

/**
 * 用户管理模块（后台）：账号 CRUD。
 *
 * 只依赖 RepositoryModule 取数据；鉴权相关的实例（better-auth）由全局 AuthModule 提供，
 * 这里不 import 它——全局模块无需显式导入即可注入。
 */
@Module({
  imports: [RepositoryModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
