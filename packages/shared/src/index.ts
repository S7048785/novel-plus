/**
 * 前后端共享的常量与配置。
 *
 * 铁律：这个入口**零运行时依赖**——不 import zod，也不 import 任何第三方包。
 * 前端会「值导入」这里的常量（下拉选项、标签映射），一旦这里顶层出现 `import { z }`，
 * zod 就会被打进前端产物（值导入会触发模块求值）。需要 schema 的请走 `@novel-plus/shared/dto`，
 * 那条路径前端只用 `import type`，编译后整条 import 消失。
 *
 * 也不 import server / admin 里的任何东西：反向依赖会形成 server → shared → server 的环。
 */

export const config = {
  /**
   * 两端端口。
   *
   * 为什么放这里：端口是唯一一处「前端和后端必须知道同一个数」的配置。放各自项目里靠人同步
   * （改后端忘了改前端代理，症状是接口 502，排查成本远高于一次 import）。
   *
   * 改这里，四个消费点会一起跟着变：server 的 app.listen、better-auth 的 baseURL、
   * vite dev server + /api 代理目标、openapi 代码生成。
   *
   * 部署时后端端口用 `PORT` 环境变量覆盖（优先级更高）——端口在容器/云平台是环境决定的，
   * 不该由仓库里的常量说了算。详见 server/src/config/ports.ts。
   */
  ports: {
    /** 后端（Nest）监听端口 */
    server: 3000,
    /** 前端（vite dev server）监听端口 */
    admin: 5799,
  },
} as const;

/* ------------------------------------------------------------------ */
/* 用户身份                                                            */
/* ------------------------------------------------------------------ */

/**
 * 用户身份（角色）的唯一定义处。
 *
 * 三个身份不是「等级」而是「能力集合」：
 * - reader：基础身份，所有账号都有（能登录、能读）。
 * - author：拥有书籍 / 章节接口能力，但**只能读写自己名下的书**。
 *   注意：作家**进不了后台**（admin 控制台只允许管理员登录）——这个身份目前是给将来的
 *   作家端预留的接口能力，不是「后台准入资格」。
 * - admin：全量权限（用户管理、书源与采集、所有书），也是唯一能进后台的身份。
 *
 * 一个账号可以同时持有多个身份（如 admin + author），所以库里是 user_role 关联表，
 * 判断权限一律用「集合里有没有某个值」，不要写成 `role === 'admin'` 这种单值比较。
 *
 * 为什么 role 列用 varchar 而不是 MySQL ENUM：加第四个身份（如 auditor）时 ENUM 要 ALTER TABLE，
 * 而身份集合的演进是可预期的；值域由 `@novel-plus/shared/dto` 里的 zod enum 兜住，
 * 写库前统一过校验，DB 层只保证长度。
 */
export const USER_ROLES = ['reader', 'author', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** 所有账号都具备的基础身份；建号与改身份时都保证它在集合里 */
export const BASE_ROLE: UserRole = 'reader';

/**
 * 可分配的身份（reader 是基础身份，不通过接口「分配」，而是自动补齐）。
 *
 * 请求体里只接受这两个：让客户端来决定「要不要给 reader」只会制造「没有身份的账号」这种非法状态。
 */
export const ASSIGNABLE_ROLES = ['author', 'admin'] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * 身份的中文名。
 *
 * 后端不消费它（响应里只有值域），放这里是因为将来作家端 / 任何新前端都要用同一套文案，
 * 分两处写迟早出现「一边叫作家一边叫作者」。
 */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  reader: '读者',
  author: '作家',
  admin: '管理员',
};

/* ------------------------------------------------------------------ */
/* 书籍入库方式                                                        */
/* ------------------------------------------------------------------ */

/**
 * 书籍的**入库方式**（这本书是怎么进来的）。
 *
 * 与 book.source_id 的区别（两者容易混，这里一次说清）：
 * - source_id：从**哪个站点**采集的，指向 crawl_source（书源），可能为 null；
 * - origin：这本书**以什么方式**进的库，是这个枚举。
 * 一本「爬虫采集」的书一定有 source_id；「手动导入 / 作家上传」的书通常没有。
 *
 * 为什么用枚举而不是「归属账号」（book.owner_id）：
 * 归属是「谁的书」，入库方式是「书怎么来的」，后者是确定的、可由系统判定的，
 * 前者需要额外的账号体系支撑（作家端未上线前根本没人可归属，字段恒为 null）。
 *
 * 值域演进（加第四种方式）只需改这里 + 数据库里补一个取值，不涉及关联表。
 */
export const BOOK_ORIGINS = ['crawl', 'author', 'manual'] as const;

export type BookOrigin = (typeof BOOK_ORIGINS)[number];

/** 新建书籍时的默认入库方式：后台手动录入就是 manual */
export const DEFAULT_BOOK_ORIGIN: BookOrigin = 'manual';

/** 入库方式的中文名（列表列、筛选项、表单下拉共用） */
export const BOOK_ORIGIN_LABELS: Record<BookOrigin, string> = {
  crawl: '爬虫采集',
  author: '作家上传',
  manual: '手动导入',
};
