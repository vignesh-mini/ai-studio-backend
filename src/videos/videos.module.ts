import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { JobQueue } from '../jobs/job-queue.service.js';
import { UsageModule } from '../usage/usage.module.js';
import { VideosController } from './videos.controller.js';
import { VideosService } from './videos.service.js';

@Module({
  imports: [AiGatewayModule, UsageModule],
  controllers: [VideosController],
  // Its own queue, so minutes-long videos never hold up image jobs.
  providers: [
    VideosService,
    { provide: JobQueue, useFactory: () => new JobQueue(2) },
  ],
})
export class VideosModule {}
