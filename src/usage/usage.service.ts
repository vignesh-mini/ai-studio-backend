import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Plan, Task } from '@prisma/client';
import { type AuthUser, isOwner } from '../auth/decorators.js';
import { dailyChatLimits } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Voice counts transcribed recordings; documents count uploads.
const MEDIA_LIMITS: Record<
  Plan,
  { images: number; videos: number; documents: number; voice: number }
> = {
  free: { images: 10, videos: 2, documents: 5, voice: 30 },
  premium: { images: 100, videos: 20, documents: 50, voice: 300 },
};

export const startOfUtcDay = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export interface UsageRecord {
  userId: string;
  task: Task;
  modelId: string;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private chatLimit(plan: Plan) {
    return dailyChatLimits((key) => this.config.get(key))[plan];
  }

  private countToday(userId: string, task: Task) {
    return this.prisma.usageLog.count({
      where: { userId, task, createdAt: { gte: startOfUtcDay() } },
    });
  }

  async assertChatQuota(user: AuthUser) {
    if (isOwner(user)) return;
    const limit = this.chatLimit(user.plan);
    if ((await this.countToday(user.id, 'chat')) >= limit) {
      throw new HttpException(
        `Daily limit of ${limit} chat messages reached. It resets at midnight UTC.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Checks room for `count` more images today (each generated image counts). */
  async assertImageQuota(user: AuthUser, count: number) {
    if (isOwner(user)) return;
    const limit = MEDIA_LIMITS[user.plan].images;
    const used = await this.countToday(user.id, 'image');
    if (used + count > limit) {
      const left = Math.max(0, limit - used);
      throw new HttpException(
        `Daily image limit reached: ${left} of ${limit} left today. It resets at midnight UTC.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async assertVideoQuota(user: AuthUser) {
    if (isOwner(user)) return;
    const limit = MEDIA_LIMITS[user.plan].videos;
    if ((await this.countToday(user.id, 'video')) >= limit) {
      throw new HttpException(
        `Daily limit of ${limit} videos reached. It resets at midnight UTC.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async assertVoiceQuota(user: AuthUser) {
    if (isOwner(user)) return;
    const limit = MEDIA_LIMITS[user.plan].voice;
    if ((await this.countToday(user.id, 'audio')) >= limit) {
      throw new HttpException(
        `Daily limit of ${limit} voice questions reached. It resets at midnight UTC.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async assertDocumentQuota(user: AuthUser) {
    if (isOwner(user)) return;
    const limit = MEDIA_LIMITS[user.plan].documents;
    if ((await this.countDocumentsToday(user.id)) >= limit) {
      throw new HttpException(
        `Daily limit of ${limit} documents reached. It resets at midnight UTC.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private countDocumentsToday(userId: string) {
    return this.prisma.document.count({
      where: { userId, createdAt: { gte: startOfUtcDay() } },
    });
  }

  record(entry: UsageRecord) {
    return this.prisma.usageLog.create({ data: entry });
  }

  async summary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, role: true },
    });
    if (!user) throw new NotFoundException();
    const [chat, images, videos, documents] = await Promise.all([
      this.countToday(userId, 'chat'),
      this.countToday(userId, 'image'),
      this.countToday(userId, 'video'),
      this.countDocumentsToday(userId),
    ]);
    const media = MEDIA_LIMITS[user.plan];
    // null = unlimited (owners).
    const cap = (limit: number) => (user.role === 'owner' ? null : limit);
    return {
      plan: user.plan,
      chat: { used: chat, limit: cap(this.chatLimit(user.plan)) },
      images: { used: images, limit: cap(media.images) },
      videos: { used: videos, limit: cap(media.videos) },
      documents: { used: documents, limit: cap(media.documents) },
      resetsAt: new Date(startOfUtcDay().getTime() + 86_400_000).toISOString(),
    };
  }
}
