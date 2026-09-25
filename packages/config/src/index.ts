import { z } from 'zod';

export const projectName = 'ХОД' as const;
export const projectVersion = '0.1.0' as const;

const timeZoneSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('ru', { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid IANA timezone' },
  );

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);
const maxWebhookSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{5,256}$/, {
  message: 'Must contain 5-256 characters: A-Z, a-z, 0-9, underscore or hyphen',
});
const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.url().optional());

export const runtimeConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url().refine((url) => url.startsWith('postgresql://'), {
      message: 'DATABASE_URL must use postgresql://',
    }),
    REDIS_URL: z.url().refine((url) => url.startsWith('redis://') || url.startsWith('rediss://'), {
      message: 'REDIS_URL must use redis:// or rediss://',
    }),
    WORKSPACE_DEFAULT_TIMEZONE: timeZoneSchema,
    MINIAPP_ORIGIN: optionalUrl,
    MAX_TRANSPORT: z.enum(['disabled', 'webhook', 'polling']).default('disabled'),
    MAX_BOT_TOKEN: optionalSecret,
    MAX_API_BASE_URL: z.url().default('https://platform-api2.max.ru'),
    MAX_API_VERSION: z.string().min(1).default('2026-07-01'),
    MAX_WEBHOOK_PUBLIC_URL: optionalUrl,
    MAX_WEBHOOK_SECRET: optionalSecret,
    MAX_MINIAPP_BOT_NAME: optionalSecret,
    AI_PROVIDER: z.enum(['disabled', 'fake', 'gigachat']).default('disabled'),
    GIGACHAT_CREDENTIALS: optionalSecret,
    GIGACHAT_SCOPE: z
      .enum(['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP'])
      .default('GIGACHAT_API_B2B'),
    GIGACHAT_MODEL: z.string().min(1).default('GigaChat-2-Pro'),
    GIGACHAT_BASE_URL: z
      .url()
      .refine((url) => url.startsWith('https://'), {
        message: 'GIGACHAT_BASE_URL must use HTTPS',
      })
      .default('https://api.giga.chat'),
    GIGACHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    AI_HIGH_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
    AI_MEDIUM_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
    MINIAPP_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
    MAX_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(300),
    REMINDER_LEAD_MINUTES: z.coerce.number().int().nonnegative().default(60),
    REMINDER_SCAN_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1_000),
    OUTBOX_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
    MAX_RATE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(10),
    PROOF_STORAGE_PATH: z.string().min(1).default('./storage/proofs'),
    PROOF_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
  })
  .superRefine((config, context) => {
    if (config.AI_HIGH_CONFIDENCE_THRESHOLD <= config.AI_MEDIUM_CONFIDENCE_THRESHOLD) {
      context.addIssue({
        code: 'custom',
        path: ['AI_HIGH_CONFIDENCE_THRESHOLD'],
        message: 'Must be greater than AI_MEDIUM_CONFIDENCE_THRESHOLD',
      });
    }

    if (config.MAX_TRANSPORT !== 'disabled' && !config.MAX_BOT_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['MAX_BOT_TOKEN'],
        message: 'Required for MAX transport',
      });
    }

    if (config.MAX_TRANSPORT === 'webhook') {
      if (!config.MAX_WEBHOOK_PUBLIC_URL?.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: ['MAX_WEBHOOK_PUBLIC_URL'],
          message: 'HTTPS URL is required for webhook transport',
        });
      }
      if (
        config.MAX_WEBHOOK_PUBLIC_URL &&
        new URL(config.MAX_WEBHOOK_PUBLIC_URL).port !== '' &&
        new URL(config.MAX_WEBHOOK_PUBLIC_URL).port !== '443'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['MAX_WEBHOOK_PUBLIC_URL'],
          message: 'MAX webhook must use HTTPS port 443',
        });
      }
      const secretResult = maxWebhookSecretSchema.safeParse(config.MAX_WEBHOOK_SECRET);
      if (!secretResult.success) {
        context.addIssue({
          code: 'custom',
          path: ['MAX_WEBHOOK_SECRET'],
          message: secretResult.error.issues[0]?.message ?? 'Invalid webhook secret',
        });
      }
    }

    if (config.MAX_TRANSPORT === 'polling' && config.NODE_ENV !== 'development') {
      context.addIssue({
        code: 'custom',
        path: ['MAX_TRANSPORT'],
        message: 'Polling is only allowed in development',
      });
    }

    if (config.AI_PROVIDER === 'gigachat' && !config.GIGACHAT_CREDENTIALS) {
      context.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'GIGACHAT_CREDENTIALS are required for GigaChat',
      });
    }

    if (config.AI_PROVIDER === 'fake' && config.NODE_ENV === 'production') {
      context.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'Fake AI is forbidden in production',
      });
    }
  });

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return runtimeConfigSchema.parse(environment);
}
