import { Module } from '@nestjs/common';
import { CrawlModule } from './crawl/crawl.module.js';
import { BookModule } from './book/book.module.js';
import { UserModule } from './user/user.module.js';

/**
 * 后台管理入口模块。
 *
 * 收纳所有面向管理端的接口：采集与书源（crawl）、书籍（book）、用户（user）。
 * 应用层只需要 import 这一个模块，不必关心后台内部拆了几个子模块。
 *
 * **目录即权限边界**：`src/admin/` 下所有 controller 统一挂 `/api/admin` 前缀且只允许管理员
 * （每个 controller 上的 `@Roles('admin')` 是实际拦截，前缀只是让人一眼看出这是运营端接口）。
 * 将来的作家端放在 `src/author/`，走 `/api/author` 前缀，复用 book service 的归属判断。
 *
 * 登录校验不在这里做：AuthModule 注册的是全局守卫，对所有模块生效。
 */
@Module({
  imports: [CrawlModule, BookModule, UserModule],
})
export class AdminModule {}
