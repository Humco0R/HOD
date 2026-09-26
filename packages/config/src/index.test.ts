import { describe, expect, it } from 'vitest';

import { runtimeConfigSchema } from './index';

const required = {
  DATABASE_URL: 'postgresql://hod:hod@localhost:5432/hod',
  REDIS_URL: 'redis://localhost:6379',
  WORKSPACE_DEFAULT_TIMEZONE: 'Europe/Moscow',
};

describe('runtimeConfigSchema', () => {
  it('accepts disabled external integrations', () => {
    expect(runtimeConfigSchema.parse(required).MAX_TRANSPORT).toBe('disabled');
  });

  it('rejects an invalid workspace timezone', () => {
    expect(() =>
      runtimeConfigSchema.parse({ ...required, WORKSPACE_DEFAULT_TIMEZONE: 'hardcoded/local' }),
    ).toThrow();
  });

  it('requires secure webhook configuration', () => {
    expect(() =>
      runtimeConfigSchema.parse({
        ...required,
        MAX_TRANSPORT: 'webhook',
        MAX_BOT_TOKEN: 'token',
        MAX_WEBHOOK_PUBLIC_URL: 'http://localhost/hook',
        MAX_WEBHOOK_SECRET: 'short',
      }),
    ).toThrow();
  });

  it('accepts the official MAX secret character set and rejects non-443 ports', () => {
    expect(
      runtimeConfigSchema.parse({
        ...required,
        MAX_TRANSPORT: 'webhook',
        MAX_BOT_TOKEN: 'token',
        MAX_WEBHOOK_PUBLIC_URL: 'https://example.com/max/webhook',
        MAX_WEBHOOK_SECRET: 'valid_secret-123',
      }).MAX_WEBHOOK_SECRET,
    ).toBe('valid_secret-123');

    expect(() =>
      runtimeConfigSchema.parse({
        ...required,
        MAX_TRANSPORT: 'webhook',
        MAX_BOT_TOKEN: 'token',
        MAX_WEBHOOK_PUBLIC_URL: 'https://example.com:8443/max/webhook',
        MAX_WEBHOOK_SECRET: 'invalid secret!',
      }),
    ).toThrow();
  });

  it('allows polling only in development', () => {
    expect(() =>
      runtimeConfigSchema.parse({
        ...required,
        NODE_ENV: 'production',
        MAX_TRANSPORT: 'polling',
        MAX_BOT_TOKEN: 'token',
      }),
    ).toThrow();
  });

  it('allows Mini App development authentication only in development', () => {
    expect(
      runtimeConfigSchema.parse({
        ...required,
        NODE_ENV: 'development',
        MINIAPP_DEV_AUTH: 'true',
        MINIAPP_DEV_EXTERNAL_USER_ID: '900000001',
      }),
    ).toMatchObject({
      MINIAPP_DEV_AUTH: true,
      MINIAPP_DEV_EXTERNAL_USER_ID: '900000001',
    });

    expect(() =>
      runtimeConfigSchema.parse({
        ...required,
        NODE_ENV: 'production',
        MINIAPP_DEV_AUTH: 'true',
      }),
    ).toThrow('MINIAPP_DEV_AUTH');
  });

  it('forbids fake AI in production', () => {
    expect(() =>
      runtimeConfigSchema.parse({ ...required, NODE_ENV: 'production', AI_PROVIDER: 'fake' }),
    ).toThrow();
  });

  it('uses explicit GigaChat defaults and requires backend credentials when enabled', () => {
    expect(() => runtimeConfigSchema.parse({ ...required, AI_PROVIDER: 'gigachat' })).toThrow(
      'GIGACHAT_CREDENTIALS',
    );
    expect(
      runtimeConfigSchema.parse({
        ...required,
        AI_PROVIDER: 'gigachat',
        GIGACHAT_CREDENTIALS: 'authorization-key',
      }),
    ).toMatchObject({
      GIGACHAT_SCOPE: 'GIGACHAT_API_B2B',
      GIGACHAT_MODEL: 'GigaChat-2-Pro',
      GIGACHAT_BASE_URL: 'https://api.giga.chat',
      GIGACHAT_TIMEOUT_MS: 60_000,
    });
  });

  it('accepts every documented GigaChat scope and rejects unknown scopes', () => {
    for (const scope of ['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP']) {
      expect(runtimeConfigSchema.parse({ ...required, GIGACHAT_SCOPE: scope }).GIGACHAT_SCOPE).toBe(
        scope,
      );
    }
    expect(() =>
      runtimeConfigSchema.parse({ ...required, GIGACHAT_SCOPE: 'GIGACHAT_API_UNKNOWN' }),
    ).toThrow();
  });

  it('does not allow disabling TLS for the GigaChat API URL', () => {
    expect(() =>
      runtimeConfigSchema.parse({ ...required, GIGACHAT_BASE_URL: 'http://api.giga.chat' }),
    ).toThrow('GIGACHAT_BASE_URL must use HTTPS');
  });
});
