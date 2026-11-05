/**
 * 书籍入库方式（`crawl` / `author` / `manual`）。
 *
 * 值域、zod schema 与中文名的唯一出处已经搬到 `packages/shared`（前端要值导入同一份值域做
 * 下拉与筛选项）。这里整份 re-export，保留 server 内已有的引用路径，避免一堆相对路径改动。
 *
 * 领域说明（source_id 与 origin 的区别、为什么不用 owner_id）见 shared 的 src/index.ts。
 */

export { BOOK_ORIGINS, DEFAULT_BOOK_ORIGIN } from '@novel-plus/shared';
export type { BookOrigin } from '@novel-plus/shared';
export { bookOriginSchema } from '@novel-plus/shared/dto';
