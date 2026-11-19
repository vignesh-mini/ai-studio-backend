import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import { SendMessageDto } from './chat.dto.js';
import { type ChatEvent, ChatService } from './chat.service.js';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /**
   * Streams the reply as Server-Sent Events:
   *   data: {"type":"token","text":"..."}   (repeated)
   *   data: {"type":"done","modelId":"gemini-flash"}
   * Closing the connection (the app's Stop button) aborts the provider request.
   */
  @Post('messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    // Throws normal JSON errors (400/403/429/503) before any SSE bytes are written.
    const prepared = await this.chat.prepare(user, dto);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    const emit = (event: ChatEvent) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    await this.chat.run(prepared, emit, abort.signal);
    res.end();
  }

  @Get('conversations')
  list(@CurrentUser() user: AuthUser) {
    return this.chat.listConversations(user.id);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.getMessages(user.id, id);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.deleteConversation(user.id, id);
  }
}
