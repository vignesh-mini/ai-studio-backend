import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import {
  AiGatewayService,
  type ResolvedModel,
} from '../ai-gateway/ai-gateway.service.js';
import { type AuthUser, effectivePlan } from '../auth/decorators.js';
import { JobQueue } from '../jobs/job-queue.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UsageService } from '../usage/usage.service.js';
import type { GenerateVideoDto } from './videos.dto.js';

@Injectable()
export class VideosService implements OnModuleInit {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly usage: UsageService,
    private readonly storage: StorageService,
    private readonly queue: JobQueue,
  ) {}

  /** The in-process queue does not survive a restart, so unfinished jobs are failed. */
  async onModuleInit() {
    const { count } = await this.prisma.generationJob.updateMany({
      where: { type: 'video', status: { in: ['queued', 'processing'] } },
      data: {
        status: 'failed',
        error: 'Interrupted by a server restart. Please try again.',
      },
    });
    if (count)
      this.logger.warn(`Marked ${count} interrupted video job(s) as failed`);
  }

  async createJob(user: AuthUser, dto: GenerateVideoDto) {
    const resolved = await this.gateway.resolveVideoModel(
      dto.model,
      effectivePlan(user),
    );
    if (!resolved.model.capabilities.includes(dto.mode)) {
      throw new BadRequestException(
        `${resolved.model.name} does not support ${dto.mode}`,
      );
    }
    await this.usage.assertVideoQuota(user);
    // Read the start frame up front so a bad id fails the request, not the job.
    const imageUrl =
      dto.mode === 'image-to-video'
        ? await this.startFrame(user, dto.sourceAssetId)
        : undefined;

    const job = await this.prisma.generationJob.create({
      data: {
        userId: user.id,
        type: 'video',
        modelId: resolved.model.id,
        prompt: dto.prompt.trim(),
        params: {
          mode: dto.mode,
          durationSec: dto.durationSec,
          aspectRatio: dto.aspectRatio,
          sourceAssetId: dto.sourceAssetId ?? null,
        },
      },
    });
    this.queue.enqueue(job.id, () =>
      this.process(job.id, user, dto, resolved, imageUrl),
    );
    return { jobId: job.id, status: job.status };
  }

  private async startFrame(user: AuthUser, assetId?: string) {
    const asset = assetId
      ? await this.prisma.generatedAsset.findUnique({ where: { id: assetId } })
      : null;
    if (!asset || asset.userId !== user.id || asset.type !== 'image') {
      throw new BadRequestException(
        'Pick an image from your library to animate.',
      );
    }
    const { data, mimeType } = await this.storage.get(asset.storageKey);
    return `data:${mimeType};base64,${data.toString('base64')}`;
  }

  private async process(
    jobId: string,
    user: AuthUser,
    dto: GenerateVideoDto,
    resolved: ResolvedModel,
    imageUrl?: string,
  ) {
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: 'processing', progress: 0.05 },
    });
    try {
      const video = await this.gateway.generateVideo(
        resolved,
        {
          prompt: dto.prompt,
          durationSec: dto.durationSec,
          aspectRatio: dto.aspectRatio,
          imageUrl,
        },
        (progress) =>
          void this.prisma.generationJob
            .update({ where: { id: jobId }, data: { progress } })
            .catch(() => undefined),
      );
      const key = await this.storage.put(video.data, video.mimeType);
      await this.prisma.generatedAsset.create({
        data: {
          userId: user.id,
          jobId,
          type: 'video',
          storageKey: key,
          mimeType: video.mimeType,
          prompt: dto.prompt.trim(),
          modelId: resolved.model.id,
          aspectRatio: dto.aspectRatio,
          durationSec: dto.durationSec,
        },
      });
      await this.usage.record({
        userId: user.id,
        task: 'video',
        modelId: resolved.model.id,
        providerId: resolved.model.providerId,
        inputTokens: 0,
        outputTokens: 0,
      });
      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'completed', progress: 1 },
      });
    } catch (error) {
      this.logger.warn(
        `${resolved.model.providerModel} video failed: ${(error as Error).message}`,
      );
      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: this.publicError(error as Error) },
      });
    }
  }

  private publicError(error: Error) {
    const message = error.message;
    if (/\b(401|403)\b/.test(message)) {
      return 'The video provider key is invalid. Check FAL_KEY on the server.';
    }
    if (/\b(402)\b|balance|credit|billing/i.test(message)) {
      return 'The video provider account is out of credit. Top it up and try again.';
    }
    if (/\b(400|422)\b|safety|nsfw|content/i.test(message)) {
      return 'The video provider rejected this prompt. Try rephrasing it.';
    }
    return 'Video generation failed. Please try again.';
  }
}
