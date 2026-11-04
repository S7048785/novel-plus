import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  /**
   * 全局守卫的回归测试：这里用的是未经 setGlobalPrefix('api') 的实例，所以路径没有 /api 前缀。
   *
   * 只断言「未登录被拦」这一侧：401 由守卫直接抛出，不查库，测试不依赖数据库里的任何数据。
   * 反向（带 cookie 能通过）需要真实会话，留给联调验证。
   *
   * 路径带 /admin：`src/admin/` 下的接口统一挂这个前缀，同时固定住「运营端接口都有 /admin 前缀」
   * 这条约定——有人新加 controller 忘了前缀，改这里的用例列表时会被提醒。
   */
  describe('AuthGuard', () => {
    it.each(['/admin/book', '/admin/users', '/admin/crawl/source'])(
      '%s 未登录返回 401',
      async (path) => {
        const res = await request(app.getHttpServer()).get(path);
        expect(res.status).toBe(401);
      },
    );

    it('健康检查是公开的（@Public 生效）', async () => {
      await request(app.getHttpServer()).get('/').expect(200);
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
