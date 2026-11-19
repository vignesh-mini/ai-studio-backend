import {
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  NotImplementedException,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { Public } from './decorators.js';

@Public()
@Controller('auth')
// Tighter limit than the global one to slow down password guessing.
@Throttle({ default: { ttl: 60_000, limit: 10 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // Express 5 routes no longer accept inline regex, so the provider is checked here.
  @Post(':provider')
  social(@Param('provider') provider: string) {
    if (provider !== 'google' && provider !== 'apple') {
      throw new NotFoundException();
    }
    throw new NotImplementedException(
      `${provider} sign-in is not set up yet. Use email and password for now.`,
    );
  }
}
