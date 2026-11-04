import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb, resolveDatabaseConfig } from '../db/database.js';
import { user, userRole } from '../db/schema.js';
import { BASE_ROLE, USER_ROLES, type UserRole } from '../common/authz/role.js';

/**
 * 改身份脚本（后台把自己锁死时的救命入口）。
 *
 * 为什么需要它：后台有三条防锁死的校验（不能改自己、不能移除最后一个管理员、不能删自己），
 * 这些校验是对的，但一旦真的没有任何管理员账号，HTTP 侧就再也进不去了——
 * 这时候只能在服务器上跑这个脚本，把某个账号提回管理员。
 *
 * 用法（在 server 目录）：
 *   # 查看当前身份
 *   npm run user:set-role -- --email admin@example.com
 *
 *   # 整体替换为「读者 + 管理员」
 *   npm run user:set-role -- --email admin@example.com --roles admin
 *
 *   # 再加一个身份（保留原有的）
 *   npm run user:set-role -- --email writer@example.com --add author
 *
 *   # 去掉一个身份（reader 去不掉，它是基础身份）
 *   npm run user:set-role -- --email writer@example.com --remove author
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

function parseRoleList(raw: string | undefined): UserRole[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((role) => {
      if (!USER_ROLES.includes(role as UserRole)) {
        throw new Error(`未知身份 ${role}，可选值：${USER_ROLES.join(' / ')}`);
      }
      return role as UserRole;
    });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email?.trim().toLowerCase();

  if (!email) {
    throw new Error(
      '用法: npm run user:set-role -- --email <邮箱> [--roles author,admin | --add author | --remove admin]',
    );
  }

  const db = createDb(resolveDatabaseConfig());

  try {
    const [target] = await db.select().from(user).where(eq(user.email, email)).limit(1);
    if (!target) throw new Error(`用户 ${email} 不存在`);

    const current = (await db.select().from(userRole).where(eq(userRole.userId, target.id))).map(
      (row) => row.role as UserRole,
    );

    // 只传 --email 时当作查看，方便先确认现状再动手
    const hasChange = args.roles !== undefined || args.add !== undefined || args.remove !== undefined;
    if (!hasChange) {
      console.log(`${email} 当前身份: ${current.join(', ') || '(无)'}`);
      return;
    }

    let next: Set<UserRole>;
    if (args.roles !== undefined) {
      next = new Set([BASE_ROLE, ...parseRoleList(args.roles)]);
    } else {
      next = new Set(current);
      for (const role of parseRoleList(args.add)) next.add(role);
      for (const role of parseRoleList(args.remove)) next.delete(role);
      // reader 是基础身份，任何账号都必须有
      next.add(BASE_ROLE);
    }

    const roles = [...next];

    await db.transaction(async (tx) => {
      await tx.delete(userRole).where(eq(userRole.userId, target.id));
      await tx.insert(userRole).values(roles.map((role) => ({ userId: target.id, role })));
    });

    console.log(`${email} 身份已更新: ${current.join(', ') || '(无)'} → ${roles.join(', ')}`);
  } finally {
    await db.$client.end();
  }
}

await main().catch((error: unknown) => {
  console.error('执行失败:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
