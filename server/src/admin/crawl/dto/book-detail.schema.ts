import { z } from 'zod';

/** 书籍详情查询参数：GET /crawl/book-detail?url=...（采集侧解析详情页，不落库） */
export const bookDetailQuerySchema = z.object({
  url: z.string().trim().min(1, 'url 不能为空').max(1024, 'url 过长'),
});

export type BookDetailQuery = z.infer<typeof bookDetailQuerySchema>;
