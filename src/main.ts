import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  // 0.0.0.0 so the Android emulator (10.0.2.2) and phones on the LAN can connect.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
