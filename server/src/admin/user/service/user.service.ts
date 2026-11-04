import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateRandomString, hashPassword } from 'better-auth/crypto';
import { UserRepository, type UserPatch, type UserSummary } from '../../../common/repo/user.repo.js';
import { UserRoleRepository, sortRoles, withBaseRole } from '../../../common/repo/user-role.repo.js';
import { BookRepository } from '../../../common/repo/book.repo.js';
import { BASE_ROLE, type UserRole } from '../../../common/authz/role.js';
import type { CreateUserInput, UpdateUserInput } from '../dto/user.payload.schema.js';
import type { ListUserQuery } from '../dto/user.query.schema.js';

/** 后台视角的用户：账号字段 + 身份集合 */
export interface AdminUserSummary extends UserSummary {
  roles: UserRole[];
}

export interface UserListResult {
  list: AdminUserSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 生成 better-auth 风格的主键：32 位 [a-zA-Z0-9]。
 *
 * 为什么不用 crypto.randomUUID()：better-auth 建出来的 user.id 是 32 位无连字符随机串
 * （@better-auth/core 的 generateId），后台建的号如果长成 UUID，同一张表里就会有两种 id 形态，
 * 排查问题时容易误判「这条是外部导入的」。字母表也照抄它，避免出现 -/_ 这类它不会生成的分隔符。
 */
function generateId(): string {
  return generateRandomString(32, 'a-z', 'A-Z', '0-9');
}

/**
 * 邮箱规范化：去首尾空格 + 小写。
 *
 * better-auth 在注册/登录时都会做同一件事（sign-up.mjs 里 `email.toLowerCase()`，
 * 登录侧则按小写入库的邮箱查），所以后台必须跟上——否则管理员建了 `Tom@Example.com`，
 * db 里存成大小写混合，用户用小写登录会查不到人，表现为「密码明明对却登录失败」。
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 用户后台管理：列表 / 详情 / 新增 / 编辑（含身份）/ 删除。
 *
 * 与 AuthController 分工：那边只回答「当前登录的是谁、有什么身份」，这边管「有哪些账号、能改什么」。
 *
 * 身份相关的三条硬约束（都在 service 里，不靠前端藏按钮）：
 * 1. 不能改自己的身份——管理员把自己降成读者，下一个请求就进不去后台了；
 * 2. 不能移除 / 删除最后一个管理员——同样会锁死后台；
 * 3. reader 恒在：身份集合由服务端补齐，客户端只提交附加身份。
 */
@Injectable()
export class UserService {
  constructor(
    private readonly repo: UserRepository,
    private readonly roleRepo: UserRoleRepository,
    private readonly bookRepo: BookRepository,
  ) {}

  async list(query: ListUserQuery): Promise<UserListResult> {
    const { list, total } = await this.repo.findAll(query);
    // 身份用一次批量查询补齐，避免每行一条 SQL
    const roleMap = await this.roleRepo.findRolesByUserIds(list.map((item) => item.id));

    return {
      list: list.map((item) => ({ ...item, roles: roleMap.get(item.id) ?? [BASE_ROLE] })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string): Promise<AdminUserSummary> {
    const found = await this.repo.findById(id);
    if (!found) throw new NotFoundException(`用户 ${id} 不存在`);
    return { ...found, roles: await this.roleRepo.findRolesByUserId(id) };
  }

  /**
   * 建号：写 user + credential account + 初始身份（同一事务，见 UserRepository.insertWithCredential）。
   *
   * 先查重是为了给出「邮箱已被 xxx 使用」这种可读错误；并发下的最终保证仍在 uq_user_email 上，
   * 所以这里查完还是要容忍索引报错（会以 500 暴露，属于极端情况，暂不做拦截翻译）。
   */
  async create(input: CreateUserInput): Promise<{ id: string }> {
    const email = normalizeEmail(input.email);
    const existed = await this.repo.findByEmail(email);
    if (existed) throw new ConflictException(`邮箱 ${email} 已被用户 ${existed.name} 使用`);

    const id = generateId();
    await this.repo.insertWithCredential({
      id,
      accountId: generateId(),
      name: input.name,
      email,
      image: input.image ?? null,
      roles: sortRoles(withBaseRole(input.roles ?? [])),
      passwordHash: await hashPassword(input.password),
    });
    return { id };
  }

  /**
   * 部分更新：昵称/邮箱/头像 + 身份（roles 是整体替换）。
   *
   * 所有校验都在写库之前完成：先改字段再发现身份不合法，会留下一半改动。
   */
  async patch(id: string, input: UpdateUserInput, currentUserId: string): Promise<{ id: string }> {
    const current = await this.get(id);

    if (input.roles !== undefined) {
      if (id === currentUserId) {
        throw new BadRequestException('不能修改自己的身份：这会把你自己锁在后台之外');
      }
      await this.assertNotRemovingLastAdmin([id], current.roles, withBaseRole(input.roles));
    }

    const patch: UserPatch = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.image !== undefined) patch.image = input.image;
    if (input.email !== undefined) {
      const email = normalizeEmail(input.email);
      // 排除自己：把邮箱改成「当前值」不该报冲突
      if (await this.repo.existsByEmailExcept(email, id)) {
        throw new ConflictException(`邮箱 ${email} 已被其他用户使用`);
      }
      patch.email = email;
    }

    const affected = await this.repo.update(id, patch);
    // 上面 get 过，这里 0 只可能是并发删除导致的，如实报 404 而不是假装成功
    if (affected === 0) throw new NotFoundException(`用户 ${id} 不存在`);

    if (input.roles !== undefined) {
      await this.roleRepo.replaceForUser(id, input.roles);
    }
    return { id };
  }

  /**
   * 删除用户（会话、登录凭据与身份一并清理）。
   *
   * 禁止删自己：手上只有一个管理员账号时，删掉自己等于把后台锁死，
   * 只能靠命令行 user:set-role 恢复，所以直接拦掉。
   */
  async remove(id: string, currentUserId: string): Promise<{ id: string; deleted: number }> {
    if (id === currentUserId) throw new BadRequestException('不能删除当前登录的账号');

    const target = await this.get(id);
    // 删人 = 身份清零，所以 nextRoles 传空数组
    await this.assertNotRemovingLastAdmin([id], target.roles, []);

    // 先清掉名下书籍的归属再删账号：book.author_id 是弱引用（无外键），
    // 不清会留下指向已删账号的 id，列表里显示成「—」却查不出原因
    await this.bookRepo.clearAuthorByUserIds([id]);

    const deleted = await this.repo.deleteById(id);
    if (deleted === 0) throw new NotFoundException(`用户 ${id} 不存在`);
    return { id, deleted };
  }

  /** 批量删除，返回实际删除行数（ids 里不存在的会被忽略） */
  async removeMany(ids: string[], currentUserId: string): Promise<{ deleted: number; ids: string[] }> {
    if (ids.includes(currentUserId)) {
      throw new BadRequestException('选择中包含当前登录的账号，请先取消勾选再删除');
    }

    const roleMap = await this.roleRepo.findRolesByUserIds(ids);
    const removingAdmins = ids.filter((id) => (roleMap.get(id) ?? []).includes('admin'));

    if (removingAdmins.length > 0) {
      const adminCount = await this.roleRepo.countByRole('admin');
      if (adminCount - removingAdmins.length < 1) {
        throw new BadRequestException('不能删除全部管理员，至少保留一个');
      }
    }

    // 与单删同理：先把这批账号名下书籍的归属清空，再删账号
    await this.bookRepo.clearAuthorByUserIds(ids);

    const deleted = await this.repo.deleteMany(ids);
    return { deleted, ids };
  }

  /**
   * 「不能没有管理员」的校验。
   *
   * 判断方式：扣掉本次会失去管理员身份的人数后，如果剩余管理员为 0 就拒绝。
   * 只有「确实有 admin 被移除」时才查库计数，普通改名不会多一次查询。
   *
   * @param targetIds 本次会被删除 / 改身份的账号
   * @param currentRoles 目标账号当前的身份
   * @param nextRoles 变更后的身份；删除场景传空数组
   */
  private async assertNotRemovingLastAdmin(
    targetIds: string[],
    currentRoles: UserRole[],
    nextRoles: UserRole[],
  ): Promise<void> {
    const losesAdmin = currentRoles.includes('admin') && !nextRoles.includes('admin');
    if (!losesAdmin) return;

    const adminCount = await this.roleRepo.countByRole('admin');
    if (adminCount - targetIds.length < 1) {
      throw new BadRequestException('不能移除最后的管理员身份，请先把管理员授给其他账号');
    }
  }
}
