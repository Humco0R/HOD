import { createGigaChatClient, GigaChatDetectionError } from './gigachat-detection.adapter';

const credentials = process.env['GIGACHAT_CREDENTIALS'];
let stage = 'configuration';

try {
  if (!credentials) {
    throw new GigaChatDetectionError(
      'GIGACHAT_CREDENTIALS are required; live smoke was not run',
      'authorization',
    );
  }
  const scope = parseScope(process.env['GIGACHAT_SCOPE']);
  const model = process.env['GIGACHAT_MODEL'] ?? 'GigaChat-2-Pro';
  const client = createGigaChatClient({
    credentials,
    scope,
    model,
    baseUrl: process.env['GIGACHAT_BASE_URL'] ?? 'https://api.giga.chat',
    timeoutMs: parsePositiveNumber(process.env['GIGACHAT_TIMEOUT_MS'], 60_000),
  });

  stage = 'models';
  const models = await client.getModels();
  if (!models.data.some((item) => item.id === model || item.id.startsWith(`${model}:`))) {
    process.stderr.write(
      `${JSON.stringify({ provider: 'gigachat', success: false, errorType: 'model_unavailable', configuredModel: model, availableModels: models.data.map((item) => item.id) })}\n`,
    );
    process.exit(1);
  }
  stage = 'chat';
  const response = await client.chat({
    model,
    messages: [
      { role: 'system', content: 'Отвечай на русском языке строго одним словом.' },
      { role: 'user', content: 'Ответь одним словом: работает' },
    ],
  });
  stage = 'response_validation';
  const content = response.choices[0]?.message.content?.trim();
  if (!content) {
    throw new Error('GigaChat smoke returned an empty response');
  }
  process.stdout.write(`${JSON.stringify({ provider: 'gigachat', model, success: true })}\n`);
} catch (error) {
  const errorType = error instanceof GigaChatDetectionError ? error.errorType : 'provider';
  const status = readStatus(error);
  process.stderr.write(
    `${JSON.stringify({ provider: 'gigachat', success: false, stage, errorType, status, errorCode: readCode(error) })}\n`,
  );
  process.exitCode = 1;
}

function parseScope(
  value: string | undefined,
): 'GIGACHAT_API_PERS' | 'GIGACHAT_API_B2B' | 'GIGACHAT_API_CORP' {
  const scope = value ?? 'GIGACHAT_API_B2B';
  if (!['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP'].includes(scope)) {
    throw new Error('GIGACHAT_SCOPE must be PERS, B2B or CORP');
  }
  return scope as 'GIGACHAT_API_PERS' | 'GIGACHAT_API_B2B' | 'GIGACHAT_API_CORP';
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0)
    throw new Error('GIGACHAT_TIMEOUT_MS must be positive');
  return result;
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const response = (error as Record<string, unknown>)['response'];
  if (!response || typeof response !== 'object') return undefined;
  const status = (response as Record<string, unknown>)['status'];
  return typeof status === 'number' ? status : undefined;
}

function readCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : undefined;
}
