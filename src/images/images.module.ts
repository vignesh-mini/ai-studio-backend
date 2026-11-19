import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { JobQueue } from '../jobs/job-queue.service.js';
import { JobsController } from '../jobs/jobs.controller.js';
import { UsageModule } from '../usage/usage.module.js';
import { ImagesController } from './images.controller.js';
import { ImagesService } from './images.service.js';
import { LibraryController } from './library.controller.js';

@Module({
  imports: [AiGatewayModule, UsageModule],
  controllers: [ImagesController, JobsController, LibraryController],
  providers: [
    ImagesService,
    { provide: JobQueue, useFactory: () => new JobQueue(2) },
  ],
})
export class ImagesModule {}
