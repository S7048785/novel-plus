import 'dotenv/config';
import { createDb, resolveDatabaseConfig } from '../db/database.js';
import { userRole } from '../db/schema.js';
import { createAuth } from './auth.config.js';
import { BASE_ROLE, USER_ROLES, type UserRole } from '../common/authz/role.js';

/**
 * 建号脚本（后台用户管理出现之前的兜底入口；日常建号走 /api/users）。
 *
 * 为什么不能复用线上实例：`disableSignUp: true` 关掉的是 better-auth 的 sign-up 路由本身，
 * 服务端调 auth.api.signUpEmail 一样被拦（守卫写在 handler 内部，不区分 HTTP 调用）。
 * 所以这里显式开一个 allowSignUp 的实例来建号——密码哈希、邮箱小写化、account 关联
 * 全部复用 better-auth 自己的逻辑，不手写 INSERT 拼 scrypt 哈希。
 *
 * 用法（在 server 目录）：
 *   npm run user:create -- --email reader@example.com --password 12345678 --name 读者
 *   npm run user:create -- --email writer@example.com --password 12345678 --role author,admin
 *
 * --role 可逗号分隔多个；reader 是基础身份，不写也会自动带上。
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

/** 解析 --role：逗号分隔，校验取值，自动补 reader 并去重 */
function parseRoles(raw: string | undefined): UserRole[] {
  const requested = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const role of requested) {
    if (!USER_ROLES.includes(role as UserRole)) {
      throw new Error(`未知身份 ${role}，可选值：${USER_ROLES.join(' / ')}`);
    }
  }

  const roles = new Set<UserRole>([BASE_ROLE, ...(requested as UserRole[])]);
  return [...roles];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  const password = args.password;
  const name = args.name ?? email?.split('@')[0];
  const roles = parseRoles(args.role);

  if (!email || !password) {
    throw new Error(
      '用法: npm run user:create -- --email <邮箱> --password <密码> [--name <昵称>] [--role author,admin]',
    );
  }

  const db = createDb(resolveDatabaseConfig());
  const auth = createAuth(db, { allowSignUp: true });

  try {
    const result = await auth.api.signUpEmail({ body: { email, password, name: name! } });

    // 身份单独落库：better-auth 不知道 user_role 的存在，建号不会带身份
    await db.insert(userRole).values(roles.map((role) => ({ userId: result.user.id, role })));

    console.log(
      `创建成功: ${result.user.email} (id=${result.user.id}, name=${result.user.name}, roles=${roles.join('+')})`,
    );
  } finally {
    // 连接池不停掉的话脚本不会退出（mysql2 的 socket 会吊着事件循环）
    await db.$client.end();
  }
}

await main().catch((error: unknown) => {
  console.error('创建失败:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
