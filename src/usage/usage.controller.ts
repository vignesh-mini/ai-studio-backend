import { Controller, Get } from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import { UsageService } from './usage.service.js';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.usage.summary(user.id);
  }
}
