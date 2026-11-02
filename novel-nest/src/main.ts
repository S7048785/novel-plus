import { NestFactory } from '@nestjs/core';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Application } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module.js';
import { AUTH } from './auth/auth.module.js';
import type { Auth } from './auth/auth.config.js';
import { attachAuth } from './auth/session.decorator.js';

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

  // 1. 挂载鉴权路由：/api/auth/* 全交给 better-auth（Express 5 的通配写法是 *splat，Express 4 才是 *）
  //
  // 为什么要绕到 express 实例上：Nest 12 的 INestApplication 只剩 use()，app.all/get/post 已经被移除；
  // 而 app.use('/api/auth', handler) 会把路径前缀从 req.url 里剥掉，better-auth 读 req.url 定位端点 → 全部 404。
  // 直接用 express 的 all() 注册全路径，不改写 url。
  const expressApp = app.getHttpAdapter().getInstance() as Application;
  expressApp.all('/api/auth/*splat', toNodeHandler(auth));

  // 2. 恢复 Nest 默认的 body 解析，业务接口（/book、/crawl 等）依赖它
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });

  // 3. 让 @Session() 能在任意请求上拿到 auth 实例（纯赋值，不查库）
  app.use(attachAuth(auth));

  // Nest 12 内置：校验挂在参数装饰器上的 Standard Schema（zod / valibot / arktype）
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
