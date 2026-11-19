import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Dummy values: the e2e suite stubs the database and never contacts providers.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_ACCESS_SECRET: 'e2e-secret-that-is-at-least-32-characters-long',
    },
  },
});
