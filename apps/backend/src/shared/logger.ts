import pino, { type Logger } from 'pino';

import type { RuntimeConfig } from '@hod/config';

const sensitivePaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.x-max-bot-api-secret',
  'req.headers.x-max-init-data',
  'GIGACHAT_CREDENTIALS',
  '*.MAX_BOT_TOKEN',
  '*.MAX_WEBHOOK_SECRET',
  '*.GIGACHAT_CREDENTIALS',
  'accessToken',
  '*.accessToken',
  'authorization',
  '*.authorization',
  '*.initData',
];

export function createLoggerOptions(config: RuntimeConfig) {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: sensitivePaths,
      censor: '[REDACTED]',
    },
  } as const;
}

export function createLogger(config: RuntimeConfig): Logger {
  return pino(createLoggerOptions(config));
}

export function toSafeErrorLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: 'UnknownError' };

  const details: Record<string, unknown> = { name: error.name };
  for (const property of ['code', 'status', 'statusCode'] as const) {
    const value = (error as Error & Record<string, unknown>)[property];
    if (typeof value === 'string' || typeof value === 'number') details[property] = value;
  }
  return details;
}
