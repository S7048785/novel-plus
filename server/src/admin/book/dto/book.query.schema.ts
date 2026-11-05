import { z } from 'zod';
import { bookOriginSchema } from '../../../common/book/origin.js';

/**
 * 书籍列表的查询参数（GET /book）。
 *
 * 与请求体 schema 分文件：查询参数永远来自 URL（全是字符串，需要 coerce），
 * 请求体来自 JSON（类型齐全），校验规则和默认值策略并不相同，混在一份里容易漏掉 coerce。
 */
export const listBookQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, 'pageSize 最大 100').default(20),
  /** 同时匹配书名与作者 */
  keyword: z.string().trim().min(1).optional(),
  sourceId: z.coerce.number().int().positive().optional(),
  /** 入库方式筛选：爬虫采集 / 作家上传 / 手动导入 */
  origin: bookOriginSchema.optional(),
});

export type ListBookQuery = z.infer<typeof listBookQuerySchema>;
