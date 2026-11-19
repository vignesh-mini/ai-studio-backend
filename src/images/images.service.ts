import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AiGatewayService,
  type ResolvedModel,
} from '../ai-gateway/ai-gateway.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { JobQueue } from '../jobs/job-queue.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UsageService } from '../usage/usage.service.js';
import type { GenerateImageDto } from './images.dto.js';

// FLUX.1 schnell accepts at most 8 steps; 4 is its default.
const STEPS = { standard: 4, high: 8 } as const;

const ENHANCE_PROMPT =
  "Rewrite the user's image idea as one vivid prompt for a text-to-image model. " +
  'Keep the subject and intent, add concrete details on composition, lighting, style ' +
  'and mood. Reply with the prompt only, under 80 words, no quotes or preamble.';

@Injectable()
export class ImagesService implements OnModuleInit {
  private readonly logger = new Logger(ImagesService.name);

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
      where: { type: 'image', status: { in: ['queued', 'processing'] } },
      data: {
        status: 'failed',
        error: 'Interrupted by a server restart. Please try again.',
      },
    });
    if (count)
      this.logger.warn(`Marked ${count} interrupted image job(s) as failed`);
  }

  async createJob(user: AuthUser, dto: GenerateImageDto) {
    const resolved = await this.gateway.resolveImageModel(dto.model, user.plan);
    await this.usage.assertImageQuota(user.id, user.plan, dto.count);

    const job = await this.prisma.generationJob.create({
      data: {
        userId: user.id,
        type: 'image',
        modelId: resolved.model.id,
        prompt: dto.prompt.trim(),
        params: {
          count: dto.count,
          aspectRatio: dto.aspectRatio,
          quality: dto.quality,
        },
      },
    });
    this.queue.enqueue(job.id, () => this.process(job.id, user, dto, resolved));
    return { jobId: job.id, status: job.status };
  }

  /** Generates images one by one so progress is visible and partial results survive. */
  private async process(
    jobId: string,
    user: AuthUser,
    dto: GenerateImageDto,
    resolved: ResolvedModel,
  ) {
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: 'processing', progress: 0.05 },
    });
    // Square-only models report 1:1 so the app shows the real shape.
    const aspectRatio = resolved.model.capabilities.includes('aspect-ratio')
      ? dto.aspectRatio
      : '1:1';

    let made = 0;
    let lastError: Error | undefined;
    for (let i = 0; i < dto.count; i++) {
      try {
        const image = await this.gateway.generateImage(resolved, {
          prompt: dto.prompt,
          steps: STEPS[dto.quality],
          aspectRatio,
        });
        const key = await this.storage.put(image.data, image.mimeType);
        await this.prisma.generatedAsset.create({
          data: {
            userId: user.id,
            jobId,
            type: 'image',
            storageKey: key,
            mimeType: image.mimeType,
            prompt: dto.prompt.trim(),
            modelId: resolved.model.id,
            aspectRatio,
          },
        });
        await this.usage.record({
          userId: user.id,
          task: 'image',
          modelId: resolved.model.id,
          providerId: resolved.model.providerId,
          inputTokens: 0,
          outputTokens: 0,
        });
        made++;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `${resolved.model.providerModel} image ${i + 1}/${dto.count} failed: ${lastError.message}`,
        );
      }
      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: { progress: 0.05 + (0.95 * (i + 1)) / dto.count },
      });
    }

    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: made
        ? { status: 'completed', progress: 1 }
        : {
            status: 'failed',
            error: this.publicError(lastError),
          },
    });
  }

  async enhancePrompt(user: AuthUser, prompt: string) {
    // Rewriting a prompt needs speed more than depth, so prefer the fastest models.
    const resolved = await this.gateway.resolveChatModel(
      'auto',
      user.plan,
      prompt,
      'fast',
    );
    const text = await this.gateway.completeText(resolved, [
      { role: 'system', content: ENHANCE_PROMPT },
      { role: 'user', content: prompt },
    ]);
    // Reasoning models may wrap thoughts in <think> tags; keep only the answer.
    return text
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim()
      .replace(/^"|"$/g, '');
  }

  private publicError(error?: Error) {
    const message = error?.message ?? '';
    if (/\b(429|4006|neuron|quota|limit)\b/i.test(message)) {
      return "The image provider's daily free allowance is used up. Try again tomorrow.";
    }
    if (/\b(400|safety|nsfw|flagged)\b/i.test(message)) {
      return 'The image provider rejected this prompt. Try rephrasing it.';
    }
    return 'Image generation failed. Please try again.';
  }
}
