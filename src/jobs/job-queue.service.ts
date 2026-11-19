import { Injectable, Logger } from '@nestjs/common';

type Task = () => Promise<void>;

/**
 * Minimal in-process queue with a concurrency limit. Jobs are persisted in
 * `generation_jobs`, so this only schedules work. Swapping it for BullMQ + Redis
 * (separate worker processes, retries) does not change the services that enqueue.
 */
@Injectable()
export class JobQueue {
  private readonly logger = new Logger(JobQueue.name);
  private readonly pending: Array<{ id: string; run: Task }> = [];
  private running = 0;

  constructor(private readonly concurrency = 2) {}

  enqueue(id: string, run: Task) {
    this.pending.push({ id, run });
    this.drain();
  }

  get size() {
    return this.pending.length + this.running;
  }

  private drain() {
    while (this.running < this.concurrency && this.pending.length) {
      const job = this.pending.shift()!;
      this.running++;
      job
        .run()
        .catch((error: Error) =>
          this.logger.error(`Job ${job.id} crashed: ${error.message}`),
        )
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }
}
