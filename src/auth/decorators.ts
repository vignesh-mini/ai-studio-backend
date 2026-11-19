import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Plan } from '@prisma/client';

export interface AuthUser {
  id: string;
  plan: Plan;
}

export const IS_PUBLIC = 'isPublic';

/** Opts a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
