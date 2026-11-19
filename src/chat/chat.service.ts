import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type ResolvedModel,
  AiGatewayService,
  isRetryableProviderError,
} from '../ai-gateway/ai-gateway.service.js';
import type { ChatTurn } from '../ai-gateway/openai-compatible.js';
import { ProviderError } from '../ai-gateway/openai-compatible.js';
import type { AuthUser } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import type { SendMessageDto } from './chat.dto.js';
import { buildContext, estimateTokens, titleFrom } from './context.js';

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; modelId: string }
  | { type: 'error'; message: string };

export interface PreparedChat {
  user: AuthUser;
  dto: SendMessageDto;
  resolved: ResolvedModel;
  turns: ChatTurn[];
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Everything that can fail with a normal HTTP error runs here, before the SSE
   * stream opens: validation, quota, model resolution and history sync.
   */
  async prepare(user: AuthUser, dto: SendMessageDto): Promise<PreparedChat> {
    const latest = dto.messages.at(-1)!;
    if (latest.role !== 'user')
      throw new BadRequestException('The last message must be from the user');
    if (dto.conversationId && !dto.assistantMessageId) {
      throw new BadRequestException(
        'assistantMessageId is required with conversationId',
      );
    }

    await this.usage.assertChatQuota(user.id, user.plan);
    const resolved = await this.gateway.resolveChatModel(
      dto.modelId,
      user.plan,
      latest.content,
    );
    if (dto.conversationId) await this.syncHistory(user.id, dto);

    return { user, dto, resolved, turns: buildContext(dto.messages) };
  }

  /**
   * Streams the reply, then saves it and records usage, even if the user pressed Stop.
   * With Auto, a provider that is busy or down before sending any text is skipped in
   * favour of the next ranked model, so one overloaded provider does not fail the chat.
   */
  async run(
    { user, dto, resolved, turns }: PreparedChat,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
  ) {
    const attempts = [resolved, ...resolved.fallbacks];
    let answered = resolved;
    let reply = '';
    let status: 'done' | 'stopped' | 'error' = 'done';

    for (const [index, attempt] of attempts.entries()) {
      answered = attempt;
      try {
        for await (const delta of this.gateway.streamChat(
          attempt,
          turns,
          signal,
        )) {
          reply += delta;
          emit({ type: 'token', text: delta });
        }
        break;
      } catch (error) {
        if (signal.aborted) {
          status = 'stopped';
          break;
        }
        // Log the provider failure without the user's prompt.
        this.logger.warn(
          `${attempt.model.providerId}/${attempt.model.providerModel} failed: ${(error as Error).message}`,
        );
        const canFallBack =
          !reply &&
          index < attempts.length - 1 &&
          isRetryableProviderError(error);
        if (canFallBack) continue;
        status = 'error';
        emit({ type: 'error', message: this.publicError(error) });
        break;
      }
    }

    if (status === 'done') emit({ type: 'done', modelId: answered.model.id });
    if (!reply) return;
    resolved = answered;

    if (dto.conversationId && dto.assistantMessageId) {
      await this.prisma.message.upsert({
        where: { id: dto.assistantMessageId },
        create: {
          id: dto.assistantMessageId,
          conversationId: dto.conversationId,
          role: 'assistant',
          content: reply,
          modelId: resolved.model.id,
          status,
        },
        update: { content: reply, modelId: resolved.model.id, status },
      });
    }
    await this.usage.record({
      userId: user.id,
      task: 'chat',
      modelId: resolved.model.id,
      providerId: resolved.model.providerId,
      inputTokens: estimateTokens(turns.map((t) => t.content).join('')),
      outputTokens: estimateTokens(reply),
    });
  }

  listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId, messages: { some: {} } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        modelId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getMessages(userId: string, conversationId: string) {
    await this.assertOwner(userId, conversationId);
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteConversation(userId: string, conversationId: string) {
    await this.assertOwner(userId, conversationId);
    await this.prisma.conversation.delete({ where: { id: conversationId } });
  }

  deleteAllConversations(userId: string) {
    return this.prisma.conversation.deleteMany({ where: { userId } });
  }

  private async assertOwner(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    // 404 rather than 403 so ids belonging to other users are not confirmed.
    if (!conversation || conversation.userId !== userId)
      throw new NotFoundException('Conversation not found');
  }

  /** Mirrors the app's visible history: removes messages it dropped, adds new ones. */
  private async syncHistory(userId: string, dto: SendMessageDto) {
    const id = dto.conversationId!;
    const existing = await this.prisma.conversation.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (existing && existing.userId !== userId)
      throw new NotFoundException('Conversation not found');

    const firstUser = dto.messages.find((m) => m.role === 'user')!;
    const now = Date.now();
    await this.prisma.$transaction([
      this.prisma.conversation.upsert({
        where: { id },
        create: {
          id,
          userId,
          modelId: dto.modelId,
          title: dto.title?.trim() || titleFrom(firstUser.content),
        },
        update: { modelId: dto.modelId },
      }),
      this.prisma.message.deleteMany({
        where: {
          conversationId: id,
          id: { notIn: dto.messages.map((m) => m.id) },
        },
      }),
      this.prisma.message.createMany({
        data: dto.messages.map((m, index) => ({
          id: m.id,
          conversationId: id,
          role: m.role,
          content: m.content,
          modelId: m.modelId,
          attachments: m.attachments as Prisma.InputJsonValue | undefined,
          createdAt: new Date(now + index),
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  private publicError(error: unknown) {
    if (error instanceof ProviderError) {
      if (error.status === 429)
        return 'The AI provider is busy (rate limit). Try again shortly or pick another model.';
      if (error.status === 401 || error.status === 403)
        return 'The AI provider rejected the server credentials.';
    }
    return 'The AI provider failed to respond. Try again or pick another model.';
  }
}
