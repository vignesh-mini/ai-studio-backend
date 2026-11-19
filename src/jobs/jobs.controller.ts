import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toJobDto } from './asset.mapper.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Polled by the app every ~1.5 s while a job runs, so it skips the rate limit. */
  @SkipThrottle()
  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const job = await this.prisma.generationJob.findUnique({
      where: { id },
      include: { assets: { orderBy: { createdAt: 'asc' } } },
    });
    if (!job || job.userId !== user.id)
      throw new NotFoundException('Job not found');
    return toJobDto(job);
  }
}
