import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module.js';
import { AiGatewayService } from './ai-gateway.service.js';

@Module({
  imports: [ModelsModule],
  providers: [AiGatewayService],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
