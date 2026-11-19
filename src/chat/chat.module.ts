import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AiGatewayModule, UsageModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
