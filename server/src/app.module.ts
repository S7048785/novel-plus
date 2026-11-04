import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './db/database.js';
import { AuthModule } from './auth/auth.module.js';
import { AdminModule } from './admin/admin.module.js';

@Module({
  // AuthModule 依赖 DatabaseModule 暴露的 DB，顺序上放它之后（Nest 不强制顺序，但读起来依赖关系是清晰的）
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, AuthModule, AdminModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
