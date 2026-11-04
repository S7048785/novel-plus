import { SetMetadata } from '@nestjs/common';

/** 元数据键：标记「该路由跳过登录校验」，由 AuthGuard 读取 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 匿名访问白名单。
 *
 * 全局守卫采用「默认拒绝」：所有 Nest 路由都要求登录，需要匿名的接口显式标 @Public()。
 * 反过来的方案（默认放行、逐个 controller 挂守卫）在新增模块时最容易漏——漏了不会报错，
 * 只是接口悄悄裸奔；默认拒绝的话，漏了至少会 401，能被立刻发现。
 *
 * 可标在 controller 类上（整个 controller 公开）或方法上（单个接口公开）。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
