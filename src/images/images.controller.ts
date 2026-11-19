import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import { EnhancePromptDto, GenerateImageDto } from './images.dto.js';
import { ImagesService } from './images.service.js';

@Controller()
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  /** Returns a job id immediately; the app polls GET /jobs/:id for results. */
  @Post('images/generate')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateImageDto) {
    return this.images.createJob(user, dto);
  }

  @Post('prompts/enhance')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async enhance(@CurrentUser() user: AuthUser, @Body() dto: EnhancePromptDto) {
    return { prompt: await this.images.enhancePrompt(user, dto.prompt) };
  }
}
