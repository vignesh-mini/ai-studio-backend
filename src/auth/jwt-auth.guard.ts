import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type AuthUser, IS_PUBLIC } from './decorators.js';

interface AccessPayload {
  sub: string;
  plan: AuthUser['plan'];
  role?: AuthUser['role'];
}

/** Registered globally: every route needs a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const [scheme, token] = String(request.headers.authorization ?? '').split(
      ' ',
    );
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token);
      request.user = {
        id: payload.sub,
        plan: payload.plan,
        // Tokens issued before roles existed carry none.
        role: payload.role ?? 'user',
      } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException('Access token expired or invalid');
    }
  }
}
