import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, like, ne, notInArray, or } from 'drizzle-orm';
import { DB, type Db } from '../../db/database.js';
import { account, session, user, userRole, type NewUserRow } from '../../db/schema.js';
import { BASE_ROLE, type UserRole } from '../authz/role.js';

/**
 * 用户 Repository：读写 better-auth 的 user 表，以及建号时必须同步写的 account 表。
 *
 * 为什么不复用 better-auth 的 `auth.api.signUpEmail`：本项目的实例关掉了 signUp
 * （disableSignUp: true 连服务端调用一起拦），要复用就得再建一个 allowSignUp 的实例。
 * 与其维护两个实例，不如按 better-auth 自身的写入契约直接落库——契约只有三条，已核对源码
 * （dist/api/routes/sign-up.mjs）：
 *   1. user 行：email 小写化，emailVerified=false
 *   2. account 行：providerId='credential'、accountId=user.id、password=hashPassword(password)
 *   3. 两行在同一事务里，缺一不可（没有 account 行 = 用户存在但永远登录不上）
 * 密码哈希与 id 生成放在 service 层（crypto 不属于数据层职责），这里只负责落库。
 */

/** 列表/详情返回的行（不含密码，account 表不参与查询） */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListUserFilter {
  page: number;
  pageSize: number;
  /** 同时匹配昵称与邮箱 */
  keyword?: string;
  /**
   * 身份筛选：author / admin 是「持有该身份」；reader 是「只有读者」（不含作家、管理员）。
   * 为什么 reader 反着来：读者是所有账号的基础身份，按「持有」筛等于不筛，
   * 真正有用的是「找出还没被授予任何附加身份的账号」。
   */
  role?: UserRole;
}

/** 建号所需的全部行数据：user 行 + 凭据 account 行 */
export interface CreateUserRecord {
  /** user.id，同时也是 account.accountId */
  id: string;
  /** account.id（独立于 user.id，better-auth 用各自的随机串） */
  accountId: string;
  name: string;
  /** 已小写化的邮箱，唯一键 uq_user_email */
  email: string;
  image: string | null;
  /** 由 service 层用 better-auth 的 hashPassword 算出 */
  passwordHash: string;
}

/** 后台管理可编辑的字段：image 传 null 表示清空 */
export interface UserPatch {
  name?: string;
  email?: string;
  image?: string | null;
}

const summarySelection = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
  image: user.image,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

@Injectable()
export class UserRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** 分页列表（按注册时间倒序，最新的在前） */
  async findAll(filter: ListUserFilter): Promise<{ list: UserSummary[]; total: number }> {
    const conditions = [];

    if (filter.keyword) {
      // 转义 LIKE 通配符，避免用户输入的 % / _ 变成模糊匹配（同 book.repo.ts）
      const kw = `%${filter.keyword.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(or(like(user.name, kw), like(user.email, kw)));
    }

    // 身份筛选走子查询而不是 join：一个用户可能有多个身份，join 会让结果出现重复行，
    // 还得再 distinct 一次；子查询只回答「这个 user.id 在不在集合里」。
    if (filter.role === BASE_ROLE) {
      conditions.push(
        notInArray(
          user.id,
          this.db
            .select({ userId: userRole.userId })
            .from(userRole)
            .where(inArray(userRole.role, ['author', 'admin'])),
        ),
      );
    } else if (filter.role) {
      conditions.push(
        inArray(
          user.id,
          this.db.select({ userId: userRole.userId }).from(userRole).where(eq(userRole.role, filter.role)),
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await this.db.select({ value: count() }).from(user).where(where);
    const total = Number(totalRow?.value ?? 0);
    if (total === 0) return { list: [], total };

    const list = await this.db
      .select(summarySelection)
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { list, total };
  }

  async findById(id: string): Promise<UserSummary | null> {
    const rows = await this.db.select(summarySelection).from(user).where(eq(user.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /** 按邮箱查（邮箱在库中恒为小写，调用方负责先小写化） */
  async findByEmail(email: string): Promise<UserSummary | null> {
    const rows = await this.db.select(summarySelection).from(user).where(eq(user.email, email)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * 建号：user + credential account + 初始身份，三组行写入同一事务。
   *
   * 身份也放进这个事务：账号建出来却没有身份，权限判断会落到「空集合」这种不该存在的状态，
   * 而「建号成功但身份没写进去」正是分开写最容易留下的中间态。
   *
   * 不做唯一性预检——邮件重复由 uq_user_email 唯一索引兜底，
   * 预检在并发下本身就有 TOCTOU 窗口，真正的保证只能在索引上。
   */
  async insertWithCredential(data: CreateUserRecord & { roles: UserRole[] }): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: data.id,
        name: data.name,
        email: data.email,
        emailVerified: false,
        image: data.image,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(account).values({
        id: data.accountId,
        accountId: data.id,
        providerId: 'credential',
        userId: data.id,
        password: data.passwordHash,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(userRole).values(data.roles.map((role) => ({ userId: data.id, role })));
    });
  }

  /** 更新可编辑字段，返回受影响行数（0 = 记录不存在） */
  async update(id: string, patch: UserPatch): Promise<number> {
    const set: Partial<NewUserRow> = { updatedAt: new Date() };
    // !== undefined 判断：image 传 null 是「清空头像」的显式意图，不能被真值判断吞掉
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.email !== undefined) set.email = patch.email;
    if (patch.image !== undefined) set.image = patch.image;

    const [result] = await this.db.update(user).set(set).where(eq(user.id, id));
    return result?.affectedRows ?? 0;
  }

  /**
   * 批量删除，返回实际删除的用户数（ids 里不存在的会被忽略）。
   *
   * session / account 在 schema 里声明了 onDelete: 'cascade'，库里的外键也确实存在；
   * 这里仍显式先删，理由与 book.repo.ts 一致：级联是业务行为，写出来才能在代码里审查，
   * 也不会因为将来某人重建表时漏了外键而变成一堆孤儿会话。
   */
  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      await tx.delete(session).where(inArray(session.userId, ids));
      await tx.delete(account).where(inArray(account.userId, ids));
      // 身份行同样显式删：user_role 的外键虽然是 cascade，但删号是业务行为，写出来更可控
      await tx.delete(userRole).where(inArray(userRole.userId, ids));
      const [result] = await tx.delete(user).where(inArray(user.id, ids));
      return result?.affectedRows ?? 0;
    });
  }

  /** 单删复用批量实现：逻辑只有一份 */
  async deleteById(id: string): Promise<number> {
    return this.deleteMany([id]);
  }

  /** 判断某邮箱是否已被「别的用户」占用（更新时用，排除自己） */
  async existsByEmailExcept(email: string, excludeId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ value: count() })
      .from(user)
      .where(and(eq(user.email, email), ne(user.id, excludeId)));
    return Number(row?.value ?? 0) > 0;
  }
}
