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
import sharp from 'sharp';
import {
  editOutputSize,
  type GeneratedImage,
  nearestAspectRatio,
} from '../ai-gateway/cloudflare-images.js';
import { type AuthUser, effectivePlan } from '../auth/decorators.js';
import { JobQueue } from '../jobs/job-queue.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UsageService } from '../usage/usage.service.js';
import type { EditImageDto, GenerateImageDto } from './images.dto.js';
import { assertAllowedImagePrompt } from './prompt-policy.js';

// FLUX.1 schnell accepts at most 8 steps; 4 is its default.
const STEPS = { standard: 4, high: 8 } as const;

/**
 * Phone cameras store portraits sideways with an EXIF "rotate" tag that the editing
 * model ignores, so the pixels are turned upright here. Large photos are also shrunk;
 * the model works at about one megapixel anyway.
 */
async function uprightPhoto(data: Buffer) {
  const { data: jpeg, info } = await sharp(data)
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  return {
    image: { data: jpeg, mimeType: 'image/jpeg' } as GeneratedImage,
    width: info.width,
    height: info.height,
  };
}

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
    assertAllowedImagePrompt(dto.prompt);
    const resolved = await this.gateway.resolveImageModel(
      dto.model,
      effectivePlan(user),
    );
    if (resolved.model.capabilities.includes('edit')) {
      throw new BadRequestException(
        `${resolved.model.name} edits photos. Switch to Edit image mode.`,
      );
    }
    await this.usage.assertImageQuota(user, dto.count);

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
    // Square-only models report 1:1 so the app shows the real shape.
    const aspectRatio = resolved.model.capabilities.includes('aspect-ratio')
      ? dto.aspectRatio
      : '1:1';
    this.queue.enqueue(job.id, () =>
      this.process(job.id, user, resolved, dto, aspectRatio, () =>
        this.gateway.generateImage(resolved, {
          prompt: dto.prompt,
          steps: STEPS[dto.quality],
          aspectRatio,
        }),
      ),
    );
    return { jobId: job.id, status: job.status };
  }

  /** Edits an uploaded photo or a library image; results keep the source shape. */
  async createEditJob(
    user: AuthUser,
    dto: EditImageDto,
    file?: Express.Multer.File,
  ) {
    assertAllowedImagePrompt(dto.prompt);
    const resolved = await this.gateway.resolveImageModel(
      dto.model,
      effectivePlan(user),
    );
    if (!resolved.model.capabilities.includes('edit')) {
      throw new BadRequestException(
        `${resolved.model.name} cannot edit photos. Pick an editing model.`,
      );
    }
    const source = await this.editSource(user, dto.sourceAssetId, file);
    await this.usage.assertImageQuota(user, dto.count);

    const size = editOutputSize(source);
    const aspectRatio = nearestAspectRatio(size.width, size.height);
    const job = await this.prisma.generationJob.create({
      data: {
        userId: user.id,
        type: 'image',
        modelId: resolved.model.id,
        prompt: dto.prompt.trim(),
        params: {
          mode: 'edit',
          count: dto.count,
          sourceAssetId: dto.sourceAssetId ?? null,
          ...size,
        },
      },
    });
    this.queue.enqueue(job.id, () =>
      this.process(job.id, user, resolved, dto, aspectRatio, () =>
        this.gateway.editImage(resolved, {
          prompt: dto.prompt,
          image: source.image,
          ...size,
        }),
      ),
    );
    return { jobId: job.id, status: job.status };
  }

  private async editSource(
    user: AuthUser,
    assetId?: string,
    file?: Express.Multer.File,
  ) {
    if (file?.buffer.length) {
      try {
        return await uprightPhoto(file.buffer);
      } catch {
        throw new BadRequestException(
          'This photo could not be read. Use a JPEG, PNG or WebP image.',
        );
      }
    }
    const asset = assetId
      ? await this.prisma.generatedAsset.findUnique({ where: { id: assetId } })
      : null;
    if (!asset || asset.userId !== user.id || asset.type !== 'image') {
      throw new BadRequestException(
        'Choose a photo or a library image to edit.',
      );
    }
    return uprightPhoto((await this.storage.get(asset.storageKey)).data);
  }

  /** Creates images one by one so progress is visible and partial results survive. */
  private async process(
    jobId: string,
    user: AuthUser,
    resolved: ResolvedModel,
    dto: { prompt: string; count: number },
    aspectRatio: string,
    make: () => Promise<GeneratedImage>,
  ) {
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: 'processing', progress: 0.05 },
    });

    let made = 0;
    let lastError: Error | undefined;
    for (let i = 0; i < dto.count; i++) {
      try {
        const image = await make();
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
      effectivePlan(user),
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
