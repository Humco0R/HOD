import { defineConfig } from 'vitest/config';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (databaseName === 'hod' || databaseName === 'postgres') {
    throw new Error('Integration tests require a dedicated test database, for example hod_test');
  }
}

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
