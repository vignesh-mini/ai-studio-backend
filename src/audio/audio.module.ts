import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { AudioController } from './audio.controller.js';
import { AudioService } from './audio.service.js';

@Module({
  imports: [AiGatewayModule, UsageModule],
  controllers: [AudioController],
  providers: [AudioService],
})
export class AudioModule {}
