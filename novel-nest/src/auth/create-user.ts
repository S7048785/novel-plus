import 'dotenv/config';
import { createDb, resolveDatabaseConfig } from '../db/database.js';
import { createAuth } from './auth.config.js';

/**
 * 建号脚本（临时方案，直到有管理端用户管理为止）。
 *
 * 为什么需要它：`disableSignUp: true` 关掉的是 better-auth 的 sign-up 路由本身，
 * 服务端调 auth.api.signUpEmail 一样被拦（守卫写在 handler 内部，不区分 HTTP 调用）。
 * 所以这里显式开一个 allowSignUp 的实例来建号——密码哈希、邮箱小写化、account 关联
 * 全部复用 better-auth 自己的逻辑，不手写 INSERT 拼 scrypt 哈希。
 *
 * 用法（在 novel-nest 目录）：
 *   npm run user:create -- --email reader@example.com --password 12345678 --name 读者
 *
 * 注意：这个脚本没有任何权限校验，别把它挂到 HTTP 上。
 */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`参数 ${arg} 缺少值`);
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  const password = args.password;
  const name = args.name ?? email?.split('@')[0];

  if (!email || !password) {
    throw new Error('用法: npm run user:create -- --email <邮箱> --password <密码> [--name <昵称>]');
  }

  const db = createDb(resolveDatabaseConfig());
  const auth = createAuth(db, { allowSignUp: true });

  try {
    const result = await auth.api.signUpEmail({ body: { email, password, name: name! } });
    console.log(`创建成功: ${result.user.email} (id=${result.user.id}, name=${result.user.name})`);
  } finally {
    // 连接池不停掉的话脚本不会退出（mysql2 的 socket 会吊着事件循环）
    await db.$client.end();
  }
}

await main().catch((error: unknown) => {
  console.error('创建失败:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
