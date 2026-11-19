import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Plan, Task } from '@prisma/client';
import { dailyChatLimits } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Image/video/document limits apply once those features run on the backend (Phases 4–6).
const MEDIA_LIMITS: Record<
  Plan,
  { images: number; videos: number; documents: number }
> = {
  free: { images: 10, videos: 2, documents: 5 },
  premium: { images: 100, videos: 20, documents: 50 },
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

  async assertChatQuota(userId: string, plan: Plan) {
    const limit = this.chatLimit(plan);
    if ((await this.countToday(userId, 'chat')) >= limit) {
      throw new HttpException(
        `Daily limit of ${limit} chat messages reached. It resets at midnight UTC.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  record(entry: UsageRecord) {
    return this.prisma.usageLog.create({ data: entry });
  }

  async summary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });
    if (!user) throw new NotFoundException();
    const [chat, images, videos] = await Promise.all([
      this.countToday(userId, 'chat'),
      this.countToday(userId, 'image'),
      this.countToday(userId, 'video'),
    ]);
    const media = MEDIA_LIMITS[user.plan];
    return {
      plan: user.plan,
      chat: { used: chat, limit: this.chatLimit(user.plan) },
      images: { used: images, limit: media.images },
      videos: { used: videos, limit: media.videos },
      documents: { used: 0, limit: media.documents },
      resetsAt: new Date(startOfUtcDay().getTime() + 86_400_000).toISOString(),
    };
  }
}
