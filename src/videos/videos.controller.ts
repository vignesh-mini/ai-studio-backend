import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import { GenerateVideoDto } from './videos.dto.js';
import { VideosService } from './videos.service.js';

@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  /** Returns a job id immediately; the app polls GET /jobs/:id for the result. */
  @Post('generate')
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateVideoDto) {
    return this.videos.createJob(user, dto);
  }
}
