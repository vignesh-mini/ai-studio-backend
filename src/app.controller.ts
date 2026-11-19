import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators.js';

@Controller()
export class AppController {
  /** Liveness check for the app, load balancers and uptime monitors. */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
