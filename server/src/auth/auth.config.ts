import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Db } from '../db/database.js';
import * as schema from '../db/schema.js';

/**
 * Better Auth 实例工厂。
 *
 * 为什么是工厂而不是模块级单例：
 * better-auth 需要一个 drizzle 实例才能工作，而 drizzle 实例（含连接池）由 DatabaseModule 持有。
 * 若在这里 `createDb()` 一把，全项目就会有两个连接池——一个给 repo，一个给鉴权，
 * 连接数翻倍且事务互不可见。所以实例由 Nest 工厂 provider 注入 DB 后创建（见 auth.module.ts）。
 *
 * 本文件不 import @nestjs/*：CLI（npx auth generate）与 seeder 都要在无 Nest 容器的场景加载它。
 */
export interface AuthFactoryOptions {
  /**
   * 允许注册。
   *
   * 默认 false ⇒ 关闭 emailAndPassword.disableSignUp，HTTP 上 /api/auth/sign-up/email 直接 400。
   * 注意：这个开关拦的是 better-auth 的路由处理器本身，服务端调 auth.api.signUpEmail 一样会被拦，
   * 因此「建号」只能走显式打开的实例（scripts 里的 seeder），不能靠复用它绕过。
   */
  allowSignUp?: boolean;
}

/** 单次登录态有效期：7 天；每次访问超过 1 天后顺延（better-auth 默认值，这里显式写出便于查） */
const SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;
const SESSION_UPDATE_AGE = 60 * 60 * 24;

export function createAuth(db: Db, options: AuthFactoryOptions = {}) {
  const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

  return betterAuth({
    /**
     * 目录叫 server（服务端），但应用名用项目名 novel-plus：
     * appName 会出现在 better-auth 的页面/日志里，"server" 这种名字放到那里没有信息量。
     */
    appName: 'novel-plus',
    // 用于签名 cookie / 加密 token，必须 ≥32 字符且高熵；缺失时 better-auth 会直接抛错（有意为之，不设默认值）
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL,
    // 与 main.ts 里挂载的路径必须一致，否则生成的 cookie path 与路由对不上
    basePath: '/api/auth',
    /**
     * 跨域白名单：前端与后端不同源时，登录响应里的 Set-Cookie 要能被浏览器接受。
     * 逗号分隔，留空则只信任 baseURL 自身的 origin。
     */
    trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    database: drizzleAdapter(db, {
      provider: 'mysql',
      /**
       * 显式传 schema：adapter 按 better-auth 的模型名（user/session/account/verification）
       * 去这里取对应的 drizzle 表。表在 schema.ts 里用的是 camelCase 属性名 + snake_case 列名，
       * adapter 认的是属性名，改名不影响它。
       */
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      /** 见 AuthFactoryOptions.allowSignUp */
      disableSignUp: !options.allowSignUp,
      minPasswordLength: 8,
      maxPasswordLength: 64,
      /**
       * 收不到验证邮件，所以不设 requireEmailVerification——一旦设为 true，
       * 未验证用户会被拒绝登录，而验证邮件需要自备 SMTP，当前没有。
       * 同理不配 sendResetPassword：忘记密码流程暂不实现（端点存在但会因缺少发信函数而报错，
       * 前端不要调用它是本项目当前的约定）。
       */
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN,
      updateAge: SESSION_UPDATE_AGE,
    },
    advanced: {
      /**
       * cookie 默认名 better-auth.session_token；显式加前缀，避免与本机其他项目同域调试时打架。
       *
       * 前缀用项目名 novel-plus 而不是目录名 server：cookie 作用域是按域名（localhost）算的，
       * 叫 "server" 太通用，本机再起一个同名目录的项目就会互相顶掉登录态。
       *
       * 注意：改这个值等于换 cookie 名，所有已登录会话立即失效，需要重新登录一次。
       */
      cookiePrefix: 'novel-plus',
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
