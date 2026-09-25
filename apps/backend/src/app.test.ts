import { afterEach, describe, expect, it } from 'vitest';

import { runtimeConfigSchema } from '@hod/config';

import { buildApp } from './app';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('bootstrap app', () => {
  const config = runtimeConfigSchema.parse({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://hod:hod@localhost:5432/hod',
    REDIS_URL: 'redis://localhost:6379',
    WORKSPACE_DEFAULT_TIMEZONE: 'Europe/Moscow',
  });

  it('returns service metadata', async () => {
    const app = buildApp({
      config,
      readiness: () => Promise.resolve({ postgres: 'up', redis: 'up' }),
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'ХОД', status: 'bootstrap', version: '0.1.0' });
  });

  it('reports dependency readiness', async () => {
    const app = buildApp({
      config,
      readiness: () => Promise.resolve({ postgres: 'up', redis: 'down' }),
    });
    apps.push(app);

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: 'not_ready',
      dependencies: { postgres: 'up', redis: 'down' },
    });
  });
});
