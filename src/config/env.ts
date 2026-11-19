const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET'] as const;

/** Fails fast at startup instead of on the first request that needs a missing value. */
export function validateEnv(config: Record<string, unknown>) {
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}. See .env.example.`,
    );
  }
  if (String(config.JWT_ACCESS_SECRET).length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters.');
  }
  return config;
}

export interface AppLimits {
  free: number;
  premium: number;
}

export const dailyChatLimits = (
  get: (key: string) => string | undefined,
): AppLimits => ({
  free: Number(get('FREE_DAILY_CHAT_LIMIT') ?? 50),
  premium: Number(get('PREMIUM_DAILY_CHAT_LIMIT') ?? 500),
});
