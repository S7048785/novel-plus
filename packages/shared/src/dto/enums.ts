import { z } from 'zod';

import { ASSIGNABLE_ROLES, BOOK_ORIGINS, USER_ROLES } from '@novel-plus/shared';

/**
 * 值域的 zod 形态。
 *
 * 值域本身（`USER_ROLES` / `BOOK_ORIGINS`）在 `@novel-plus/shared` 的零依赖入口里，
 * 这里只是把它们包成 zod enum。为什么分开放：前端会「值导入」值域（下拉选项、标签），
 * 而 zod 只能被 `import type` 消费——混在一个入口里会把 zod 拖进前端产物。
 *
 * 注意这里的相对/包名引用写法：shared 内部一律用包名自引用，不用 `./xxx.ts`。
 * 因为 shared 是源码直出、由 Node 直接加载 `.ts`，包内相对导入必须带 `.ts` 后缀
 * （写 `.js` 时 TS 能过、Node 运行时找不到文件），而那会强迫所有消费包都开
 * `allowImportingTsExtensions`。走包名则路径由 exports 解析，两边都不用改配置。
 */

export const userRoleSchema = z.enum(USER_ROLES);

/** 请求体里允许指定的身份：只能给 author / admin，reader 由服务端补 */
export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES);

export const bookOriginSchema = z.enum(BOOK_ORIGINS);
