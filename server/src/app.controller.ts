import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';
import { AppService } from './app.service.js';
import { ApiZodOk } from './common/dto/openapi.js';
import { Public } from './auth/public.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** 健康检查：返回固定文案，用于确认服务在跑（挂在 /api 下） */
  @Get()
  @Public()
  @ApiZodOk(z.string())
  getHello(): string {
    return this.appService.getHello();
  }
}
