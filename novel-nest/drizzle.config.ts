import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { resolveDatabaseConfig } from './src/db/database.js';

// 连接参数与运行时共用一份解析逻辑（src/db/database.ts），不再各自维护一套默认值
const dbConfig = resolveDatabaseConfig();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
  },
  strict: true,
  verbose: true,
});
