import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind a hosting proxy (Render), trust its X-Forwarded-For so rate limits apply
  // per client instead of to the proxy's single IP.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  // 0.0.0.0 so the Android emulator (10.0.2.2) and hosting platforms can connect.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
