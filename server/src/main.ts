import { NestFactory } from '@nestjs/core';
import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Application } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module.js';
import { AUTH } from './auth/auth.tokens.js';
import type { Auth } from './auth/auth.config.js';
import { attachAuth } from './auth/session.decorator.js';
import { getServerPort } from './config/ports.js';

async function bootstrap() {
  /**
   * bodyParser: false 是接入 better-auth 的前置条件，不是可选项。
   *
   * 原因：Nest 默认在建 app 时就注册 express.json()，而 body parser 会**消费掉请求流**。
   * better-auth 的 handler 需要读原始流自己解析（它要按自己的 schema 处理 body），
   * 流被读过一次就是空的 → 注册/登录拿到空 body，直接报校验失败。
   * 所以顺序必须是：先挂 auth handler，再补回 body parser。
   */
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // 实例由 AuthModule 借助 DB 连接池构造，这里只取用，不新建（否则会多出一个连接池）
  const auth = app.get<Auth>(AUTH);

  /**
   * 所有业务接口统一前缀 /api。
   *
   * 要求放在 createDocument 之前（这里是延迟到首次请求才建文档，所以顺序天然满足）。
   * 注意 AuthController 因此挂的是 /api/user/me 而不是 /api/auth/me——后者会被下面
   * better-auth 的 /api/auth/* 通配吃掉，见 auth.controller.ts 的说明。
   */
  app.setGlobalPrefix('api');

  // 1. 挂载鉴权路由：/api/auth/* 全交给 better-auth（Express 5 的通配写法是 *splat，Express 4 才是 *）
  //
  // 为什么要绕到 express 实例上：Nest 12 的 INestApplication 只剩 use()，app.all/get/post 已经被移除；
  // 而 app.use('/api/auth', handler) 会把路径前缀从 req.url 里剥掉，better-auth 读 req.url 定位端点 → 全部 404。
  // 直接用 express 的 all() 注册全路径，不改写 url。
  //
  // 注册顺序也在起作用：这行发生在 app.listen() 之前，早于 Nest 把 controller 路由挂到 express 上，
  // 所以 /api/auth/* 下的任何路径都先被这里接住——业务侧不要在这个命名空间下建接口。
  const expressApp = app.getHttpAdapter().getInstance() as Application;
  expressApp.all('/api/auth/*splat', toNodeHandler(auth));

  // 2. 恢复 Nest 默认的 body 解析，业务接口（/api/admin/book、/api/admin/crawl 等）依赖它
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });

  // 3. 让 @Session() 能在任意请求上拿到 auth 实例（纯赋值，不查库）
  app.use(attachAuth(auth));

  // Nest 12 内置：校验挂在参数装饰器上的 Standard Schema（zod / valibot / arktype）
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  /**
   * OpenAPI：Swagger UI 在 /docs，规范文件在 /openapi.json（前端 codegen 的输入）。
   *
   * 请求参数与请求体是自动的——Nest 12 的 Swagger 模块会读参数装饰器上 zod schema 的
   * `~standard.jsonSchema` 扩展完成转换，不需要写 @ApiProperty。
   * 响应体则在 handler 上用 @ApiZodOk / @ApiZodCreated 声明（见 common/dto/openapi.ts 的原因说明）。
   *
   * operationId 默认是 `BookController_list` 这种，生成的 SDK 函数名会很丑；
   * 这里收敛成 `book_list`，前端 codegen 后就是 bookList / crawlSourceGet 这类命名。
   */
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Novel Plus Admin API')
    .setDescription('小说采集与内容管理的后台接口。登录态走 better-auth 的 httpOnly cookie。')
    .setVersion('1.0')
    // 只影响文档：Swagger UI 里点 Authorize 填 cookie 值后可以直接试调需要登录的接口。
    // 名字要与 auth.config.ts 的 cookiePrefix 一致（前缀 novel-plus + 默认后缀 session_token）
    .addCookieAuth('novel-plus.session_token')
    .build();

  const openapiDocument = () =>
    SwaggerModule.createDocument(app, swaggerConfig, {
      operationIdFactory: (controllerKey, methodKey) =>
        `${controllerKey.replace(/Controller$/, '').toLowerCase()}_${methodKey}`,
    });

  SwaggerModule.setup('docs', app, openapiDocument, {
    jsonDocumentUrl: 'openapi.json',
  });

  // 端口来自 packages/shared 的 config.ports.server（PORT 环境变量优先）：见 config/ports.ts。
  // Nest 不像 vite 那样把监听地址打进日志，而端口有两个来源，所以这里显式打一行，
  // 免得排查「为什么它跑在 3000」时只能靠猜（.env 里的 PORT 会静默盖掉共享包的值）。
  const port = getServerPort();
  Logger.log(`HTTP 监听 http://localhost:${port}`, 'Bootstrap');
  await app.listen(port);
}
await bootstrap();
