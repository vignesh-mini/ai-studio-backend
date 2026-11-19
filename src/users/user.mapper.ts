import type { User } from '@prisma/client';

/** The public user shape the mobile app expects. Never exposes the password hash. */
export const toUserDto = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  plan: user.plan,
  role: user.role,
});
