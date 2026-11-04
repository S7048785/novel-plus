import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';
import * as schema from './schema.js';

/**
 * 数据库层：连接参数解析 + 连接池 + Nest 模块，集中在一个文件里。
 *
 * 表结构单独放 schema.ts，不作为「散」来处理——它是 drizzle-kit 的解析入口
 * （drizzle.config.ts 的 schema 指向它），混进 Nest 的装饰器会让 drizzle-kit
 * 加载 schema 时被迫拉起 @nestjs/common。
 */

/* ------------------------------ 连接参数 ------------------------------ */

/**
 * 优先级：进程环境变量 > 内置默认值。.env 由 ConfigModule（应用侧）/ dotenv（drizzle-kit 侧）注入。
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const DEFAULTS = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '',
  database: 'novel_nest',
} as const;

/**
 * 纯函数、不依赖 Nest DI，因此运行时与 drizzle.config.ts 可共用同一份逻辑，
 * 不必在两边各维护一套默认值。
 */
export function resolveDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return {
    host: env.DB_HOST || DEFAULTS.host,
    port: Number(env.DB_PORT || DEFAULTS.port),
    user: env.DB_USER || DEFAULTS.user,
    // 密码允许显式空串，故用 ?? 而非 ||
    password: env.DB_PASSWORD ?? DEFAULTS.password,
    database: env.DB_NAME || DEFAULTS.database,
  };
}

/* ------------------------------ 连接池 ------------------------------ */

export type Db = ReturnType<typeof createDb>;

export function createDb(connection: DatabaseConfig) {
  const pool: Pool = createPool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    connectionLimit: 10,
  });

  return drizzle(pool, { schema, mode: 'default' });
}

/* ------------------------------ Nest 模块 ------------------------------ */

/** 数据库注入 token。用常量而非裸字符串，避免各模块各写一份 'DB' 拼错后静默拿不到实例。 */
export const DB = 'DB';

/**
 * 数据库模块（全局）。
 *
 * 声明为 @Global 的理由：连接池是全项目单例基础设施，业务模块（crawl、book、以后的 reader 等）
 * 只应依赖「Db 类型 + DB token」，不该为了拿连接池而 import 别的业务模块。
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => createDb(resolveDatabaseConfig()),
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
