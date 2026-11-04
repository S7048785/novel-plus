import { z } from 'zod';

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

export const bookOriginSchema = z.enum(BOOK_ORIGINS);

/** 新建书籍时的默认入库方式：后台手动录入就是 manual */
export const DEFAULT_BOOK_ORIGIN: BookOrigin = 'manual';
