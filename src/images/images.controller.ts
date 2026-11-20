import {
  Body,
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import {
  EditImageDto,
  EnhancePromptDto,
  GenerateImageDto,
} from './images.dto.js';
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

  /** Multipart: the instruction fields plus either an `image` file or sourceAssetId. */
  @Post('images/edit')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  edit(
    @CurrentUser() user: AuthUser,
    @Body() dto: EditImageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.images.createEditJob(user, dto, file);
  }

  @Post('prompts/enhance')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async enhance(@CurrentUser() user: AuthUser, @Body() dto: EnhancePromptDto) {
    return { prompt: await this.images.enhancePrompt(user, dto.prompt) };
  }
}
