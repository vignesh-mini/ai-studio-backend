import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Plan, UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  plan: Plan;
  role: UserRole;
}

export const isOwner = (user: AuthUser) => user.role === 'owner';

/** Owners get every model regardless of their billing plan. */
export const effectivePlan = (user: AuthUser): Plan =>
  isOwner(user) ? 'premium' : user.plan;

export const IS_PUBLIC = 'isPublic';

/** Opts a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
