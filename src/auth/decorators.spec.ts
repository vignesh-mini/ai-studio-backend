import { effectivePlan, isOwner } from './decorators.js';

describe('owner role', () => {
  it('gives owners premium access regardless of billing plan', () => {
    const owner = { id: '1', plan: 'free' as const, role: 'owner' as const };
    expect(isOwner(owner)).toBe(true);
    expect(effectivePlan(owner)).toBe('premium');
  });

  it('keeps regular users on their own plan', () => {
    const user = { id: '2', plan: 'free' as const, role: 'user' as const };
    expect(isOwner(user)).toBe(false);
    expect(effectivePlan(user)).toBe('free');
  });
});
