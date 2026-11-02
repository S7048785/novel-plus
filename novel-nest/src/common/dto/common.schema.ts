import { z } from 'zod';

/** 数字 id：URL / query 传进来的是字符串，统一 coerce */
export const idSchema = z.coerce.number().int().positive();

export const idParamsSchema = z.object({ id: idSchema });

export type IdParams = z.infer<typeof idParamsSchema>;
