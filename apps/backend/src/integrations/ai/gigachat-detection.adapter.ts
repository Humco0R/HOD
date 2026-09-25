import GigaChat, { type GigaChatClientConfig } from 'gigachat';
import { z } from 'zod';

import { normalizeDetectionCandidate } from '../../modules/detections';
import type {
  AiDetectionInput,
  AiDetectionPort,
  DetectionCandidate,
} from '../../modules/detections';

const promptVersion = 'hod-detection-v2';
const maximumAttempts = 3;

export const gigaChatDetectionSchema = z.object({
  classification: z.enum(['ACTIONABLE', 'NOT_ACTIONABLE', 'UNCERTAIN']),
  title: z.string().nullable(),
  assigneeReference: z.string().nullable(),
  deadlineKind: z.enum(['EXACT_DATETIME', 'DATE_ONLY', 'RELATIVE', 'DEPENDENCY', 'UNKNOWN']),
  deadlineAt: z.string().nullable(),
  deadlineDate: z.string().nullable(),
  deadlineDependency: z.string().nullable(),
  deadlineRaw: z.string().nullable(),
  expectedResultType: z.enum(['PHOTO', 'FILE', 'TEXT', 'NONE', 'UNKNOWN']),
  expectedResultText: z.string().nullable(),
  location: z.string().nullable(),
  confidence: z.number(),
});

export interface GigaChatDetectionOptions {
  credentials: string;
  scope: 'GIGACHAT_API_PERS' | 'GIGACHAT_API_B2B' | 'GIGACHAT_API_CORP';
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

interface GigaChatClient {
  chat(payload: Record<string, unknown>): Promise<{
    choices: Array<{ message: { content?: string } }>;
    model: string;
    xHeaders?: Record<string, string>;
  }>;
}

interface DetectionLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

type Sleep = (milliseconds: number) => Promise<void>;
type GigaChatErrorType =
  | 'authorization'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'provider'
  | 'invalid_response';

export class GigaChatDetectionError extends Error {
  constructor(
    message: string,
    readonly errorType: GigaChatErrorType,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GigaChatDetectionError';
  }
}

export class GigaChatDetectionAdapter implements AiDetectionPort {
  private readonly client: GigaChatClient;

  constructor(
    private readonly options: GigaChatDetectionOptions,
    client?: GigaChatClient,
    private readonly logger: DetectionLogger = noOpLogger,
    private readonly sleep: Sleep = delay,
  ) {
    this.client = client ?? createGigaChatClient(options);
  }

  async detect(input: AiDetectionInput): Promise<DetectionCandidate> {
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await this.client.chat(buildChatRequest(this.options.model, input));
        const candidate = parseCandidate(response.choices[0]?.message.content);
        let normalized: DetectionCandidate;
        try {
          normalized = normalizeDetectionCandidate({
            ...candidate,
            raw: {
              adapter: 'gigachat',
              model: this.options.model,
              promptVersion,
            },
          });
        } catch (error) {
          throw new GigaChatDetectionError(
            'GigaChat response failed domain validation',
            'invalid_response',
            undefined,
            { cause: error },
          );
        }
        this.logger.info(
          {
            provider: 'gigachat',
            model: this.options.model,
            operation: 'detect_action',
            latency_ms: Date.now() - startedAt,
            success: true,
            attempt,
            request_id: response.xHeaders?.['xRequestID'],
            correlation_id: input.job.sourceMessageId,
          },
          'GigaChat request completed',
        );
        return normalized;
      } catch (error) {
        const failure = classifyError(error);
        this.logger.warn(
          {
            provider: 'gigachat',
            model: this.options.model,
            operation: 'detect_action',
            latency_ms: Date.now() - startedAt,
            success: false,
            attempt,
            status: failure.status,
            error_type: failure.type,
            correlation_id: input.job.sourceMessageId,
          },
          'GigaChat request failed',
        );
        if (error instanceof GigaChatDetectionError) throw error;
        if (failure.retryable && attempt < maximumAttempts) {
          await this.sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        throw new GigaChatDetectionError(
          safeErrorMessage(failure.type),
          failure.type,
          failure.status,
        );
      }
    }
    throw new GigaChatDetectionError('GigaChat request failed', 'provider');
  }
}

export function createGigaChatClient(options: GigaChatDetectionOptions): GigaChat {
  return new GigaChat(buildGigaChatClientConfig(options));
}

export function buildGigaChatClientConfig(options: GigaChatDetectionOptions): GigaChatClientConfig {
  if (!isGigaChatAuthorizationKey(options.credentials)) {
    throw new GigaChatDetectionError(
      'GigaChat credentials must be a Base64 Authorization Key',
      'authorization',
    );
  }
  return {
    credentials: options.credentials,
    scope: options.scope,
    model: options.model,
    baseUrl: normalizeGigaChatBaseUrl(options.baseUrl),
    timeout: options.timeoutMs / 1_000,
  };
}

export function isGigaChatAuthorizationKey(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return false;
  }
  try {
    const parts = Buffer.from(value, 'base64').toString('utf8').split(':');
    return parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]);
  } catch {
    return false;
  }
}

export function normalizeGigaChatBaseUrl(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/\/$/u, '');
  url.pathname = path === '' ? '/v1' : path;
  return url.toString().replace(/\/$/u, '');
}

const systemPrompt = `Ты — семантический компилятор рабочих сообщений для ХОД.
Отвечай на русском языке. Верни только JSON, соответствующий переданной JSON Schema.
Классифицируй только triggerMessage.text. previousMessages — контекст для понимания ссылок и местоимений, а не новые поручения.
Если новое сообщение не содержит нового поручения или явного подтверждения поручения из контекста, верни NOT_ACTIONABLE. Не повторяй поручение из previousMessages при реакции, обсуждении или другом новом сообщении.
title, assigneeReference, срок и результат должны описывать именно triggerMessage; контекст может лишь уточнить их.
Твоя задача — найти только реальное поручение, но не создавать обязательство.
Precision важнее recall. Вопросы, обсуждения, идеи и шум — NOT_ACTIONABLE или UNCERTAIN.
Не угадывай неизвестное: используй null и UNKNOWN. Никогда не придумывай user ID.
assigneeReference — имя или username ровно из текста, backend сопоставит его с участниками.
ACTIONABLE требует короткий title в инфинитиве. Для остальных classification title всегда null.
Сроки:
- Поля срока строго взаимоисключающие. Никогда не дублируй один срок в нескольких полях.
- EXACT_DATETIME — только когда известны дата и время; deadlineAt — ISO 8601 с offset; deadlineDate и deadlineDependency — null.
- DATE_ONLY — дата без придуманного времени, YYYY-MM-DD в deadlineDate; deadlineAt и deadlineDependency — null.
- DEPENDENCY — «после клиента/Кирова/поставки» только в deadlineDependency; deadlineAt и deadlineDate — null; не превращай зависимость во время.
- RELATIVE — неразрешённая относительная формулировка остаётся только в deadlineRaw; deadlineAt, deadlineDate и deadlineDependency — null.
- UNKNOWN — deadlineAt, deadlineDate и deadlineDependency — null.
deadlineRaw сохраняет исходную формулировку срока. Учитывай timezone и reference time из входа.
expectedResultType определяй только по явному или надёжно подразумеваемому результату.
confidence — число 0..1 для всей структуры. Не повышай confidence при неоднозначности.`;

function buildChatRequest(model: string, input: AiDetectionInput): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildPromptInput(input) },
    ],
    temperature: 0,
    response_format: {
      type: 'json_schema',
      schema: responseJsonSchema,
      strict: true,
    },
  };
}

function buildPromptInput(input: AiDetectionInput): string {
  const occurredAt = new Date(input.job.occurredAt);
  const localReference = new Intl.DateTimeFormat('ru-RU', {
    timeZone: input.timezone,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(occurredAt);
  return JSON.stringify({
    timezone: input.timezone,
    referenceTimeUtc: occurredAt.toISOString(),
    referenceTimeLocal: localReference,
    members: input.members.map((member) => ({
      firstName: member.firstName,
      lastName: member.lastName,
      username: member.username,
    })),
    previousMessages: input.job.context
      .filter((message) => message.messageId !== input.job.sourceMessageId)
      .slice(-4)
      .map((message) => ({
        messageId: message.messageId,
        senderMaxUserId: message.senderMaxUserId,
        timestamp: message.timestamp,
        text: message.text,
      })),
    triggerMessage: {
      messageId: input.job.sourceMessageId,
      senderMaxUserId: input.job.sourceSenderExternalId,
      timestamp: input.job.occurredAt,
      text: input.job.text,
    },
  });
}

function parseCandidate(content: string | undefined): z.infer<typeof gigaChatDetectionSchema> {
  if (!content?.trim()) {
    throw new GigaChatDetectionError('GigaChat returned an empty response', 'invalid_response');
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new GigaChatDetectionError(
      'GigaChat returned invalid JSON',
      'invalid_response',
      undefined,
      {
        cause: error,
      },
    );
  }
  const parsed = gigaChatDetectionSchema.safeParse(value);
  if (!parsed.success) {
    throw new GigaChatDetectionError(
      'GigaChat response failed local schema validation',
      'invalid_response',
      undefined,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function classifyError(error: unknown): {
  type: GigaChatErrorType;
  status?: number;
  retryable: boolean;
} {
  if (error instanceof GigaChatDetectionError) {
    return error.status === undefined
      ? { type: error.errorType, retryable: false }
      : { type: error.errorType, status: error.status, retryable: false };
  }
  const status = readNumber(error, ['response', 'status']) ?? readNumber(error, ['status']);
  if (status === 401) return { type: 'authorization', status, retryable: false };
  if (status === 429) return { type: 'rate_limit', status, retryable: true };
  if (status !== undefined) {
    return {
      type: 'provider',
      status,
      retryable: [500, 502, 503, 504].includes(status),
    };
  }
  const code = readString(error, ['code']);
  if (code && ['ECONNABORTED', 'ETIMEDOUT'].includes(code)) {
    return { type: 'timeout', retryable: true };
  }
  if (code && ['ERR_NETWORK', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    return { type: 'network', retryable: true };
  }
  return { type: 'provider', retryable: false };
}

function readNumber(value: unknown, path: string[]): number | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'number' ? current : undefined;
}

function readString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function safeErrorMessage(type: GigaChatErrorType): string {
  switch (type) {
    case 'authorization':
      return 'GigaChat authorization failed';
    case 'rate_limit':
      return 'GigaChat rate limit exceeded';
    case 'timeout':
      return 'GigaChat request timed out';
    case 'network':
      return 'GigaChat network request failed';
    case 'invalid_response':
      return 'GigaChat returned an invalid response';
    case 'provider':
      return 'GigaChat request failed';
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const generatedJsonSchema = z.toJSONSchema(gigaChatDetectionSchema) as Record<string, unknown>;
delete generatedJsonSchema['$schema'];
const responseJsonSchema = generatedJsonSchema;

const noOpLogger: DetectionLogger = {
  info: () => undefined,
  warn: () => undefined,
};
