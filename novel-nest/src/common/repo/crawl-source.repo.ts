import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, like, or } from 'drizzle-orm';
import { DB, type Db } from '../../db/database.js';
import { crawlSource, type CrawlSourceJson, type CrawlSourceRow } from '../../db/schema.js';
import type { BookSource, BookSourceConfig } from '../model/book-source.js';
import { SourceStatus } from '../model/book-source.js';

/** 列表行：不含 json 规则体（列表页不需要整份配置，避免每行反序列化几 KB） */
export interface CrawlSourceSummary {
  id: number;
  sourceName: string;
  sourceUrl: string;
  enabled: boolean;
  status: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListSourceFilter {
  /** 同时匹配书源名称与地址 */
  keyword?: string;
  enabled?: boolean;
}

/**
 * 书源 Repository：负责 crawl_source 表的读写。
 *
 * 书源配置整体以 json 一列存储（类型契约 = BookSourceConfig），
 * 序列化/反序列化收敛到本文件的 serializeConfig / deserializeConfig 两个函数，
 * 不在调用处散落类型断言。
 */
@Injectable()
export class CrawlSourceRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async insert(data: BookSource): Promise<number> {
    const now = new Date();
    const [result] = await this.db
      .insert(crawlSource)
      .values({
        sourceUrl: data.bookSourceUrl,
        sourceName: data.bookSourceName,
        enabled: data.enabled ?? false,
        status: SourceStatus.AVAILABLE,
        json: serializeConfig(data),
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    return result?.id ?? 0;
  }

  async findById(id: number): Promise<BookSource | null> {
    const rows = await this.db.select().from(crawlSource).where(eq(crawlSource.id, id)).limit(1);
    if (rows.length === 0) return null;
    return toBookSource(rows[0]);
  }

  async findByUrl(sourceUrl: string): Promise<BookSource | null> {
    const rows = await this.db.select().from(crawlSource).where(eq(crawlSource.sourceUrl, sourceUrl)).limit(1);
    if (rows.length === 0) return null;
    return toBookSource(rows[0]);
  }

  /** 列表查询（不含规则体），按 id 倒序 */
  async findAll(filter: ListSourceFilter = {}): Promise<CrawlSourceSummary[]> {
    const conditions = [];
    if (filter.keyword) {
      // 转义 LIKE 通配符，避免用户输入的 % / _ 变成模糊匹配
      const kw = `%${filter.keyword.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(or(like(crawlSource.sourceName, kw), like(crawlSource.sourceUrl, kw)));
    }
    if (filter.enabled !== undefined) {
      conditions.push(eq(crawlSource.enabled, filter.enabled));
    }

    return this.db
      .select({
        id: crawlSource.id,
        sourceName: crawlSource.sourceName,
        sourceUrl: crawlSource.sourceUrl,
        enabled: crawlSource.enabled,
        status: crawlSource.status,
        createdAt: crawlSource.createdAt,
        updatedAt: crawlSource.updatedAt,
      })
      .from(crawlSource)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(crawlSource.id));
  }

  /**
   * 全部书源（含规则体）。
   * 用于需要遍历规则做匹配的场景，例如按书籍 URL 反查它属于哪个书源。
   */
  async findAllFull(): Promise<BookSource[]> {
    const rows = await this.db.select().from(crawlSource);
    return rows.map(toBookSource);
  }

  /** 删除单个，返回受影响行数（0 表示不存在） */
  async deleteById(id: number): Promise<number> {
    const [result] = await this.db.delete(crawlSource).where(eq(crawlSource.id, id));
    return result?.affectedRows ?? 0;
  }

  /** 批量删除，返回受影响行数 */
  async deleteMany(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const [result] = await this.db.delete(crawlSource).where(inArray(crawlSource.id, ids));
    return result?.affectedRows ?? 0;
  }

  /** 更新运行状态（采集成功/失败时调用） */
  async updateStatus(id: number, status: SourceStatus): Promise<void> {
    await this.db
      .update(crawlSource)
      .set({ status, updatedAt: new Date() })
      .where(eq(crawlSource.id, id));
  }

  /**
   * 覆盖已有书源的配置（按 id），用于书源规则重新导入/修正。
   * 只改配置与展示字段，不动运行状态 status（那是采集运行时的观测值）。
   */
  async updateConfig(id: number, data: BookSource): Promise<void> {
    await this.db
      .update(crawlSource)
      .set({
        sourceUrl: data.bookSourceUrl,
        sourceName: data.bookSourceName,
        enabled: data.enabled ?? false,
        json: serializeConfig(data),
        updatedAt: new Date(),
      })
      .where(eq(crawlSource.id, id));
  }
}

/** BookSource → json 列值（去掉 id/status 标量列，只留配置） */
function serializeConfig(source: BookSource): CrawlSourceJson {
  const { id: _id, status: _status, ...config } = source;
  return config;
}

/** DB 行 → 领域模型：json 列反序列化 + status 标量列单独映射 */
function toBookSource(row: CrawlSourceRow): BookSource {
  const config = deserializeConfig(row.json);
  return { ...config, id: row.id, status: row.status as SourceStatus };
}

/**
 * json 列（unknown）→ BookSourceConfig。
 * mysql2 驱动对 json 列已自动 parse 成对象，这里做一次运行时收窄 + 类型标注。
 */
function deserializeConfig(raw: unknown): BookSourceConfig {
  if (raw !== null && typeof raw === 'object') {
    return raw as BookSourceConfig;
  }
  // 兜底：json 列异常时返回空配置，避免调用方空指针
  return {} as BookSourceConfig;
}
