import { GigaChatDetectionAdapter, GigaChatDetectionError } from '../gigachat-detection.adapter';
import { createGoldenDataset } from './golden-dataset';
import { validateGoldenDataset } from './validate-golden';

const credentials = process.env['GIGACHAT_CREDENTIALS'];
if (!credentials) throw new Error('GIGACHAT_CREDENTIALS are required for credentialed eval');

const model = process.env['GIGACHAT_MODEL'] ?? 'GigaChat-2-Pro';
const scope = parseScope(process.env['GIGACHAT_SCOPE']);
const baseUrl = process.env['GIGACHAT_BASE_URL'] ?? 'https://api.giga.chat';
const timeoutMs = parsePositiveNumber(process.env['GIGACHAT_TIMEOUT_MS'], 60_000);
const dataset = createGoldenDataset();
validateGoldenDataset(dataset);
const requestedLimit = Number(process.env['AI_EVAL_LIMIT'] ?? dataset.length);
const cases = dataset.slice(
  0,
  Number.isSafeInteger(requestedLimit) ? requestedLimit : dataset.length,
);
const adapter = new GigaChatDetectionAdapter({ credentials, model, scope, baseUrl, timeoutMs });
let classificationMatches = 0;
let deadlineMatches = 0;
let resultMatches = 0;
let assigneeMatches = 0;
let assigneeCases = 0;
let schemaFailures = 0;
let truePositive = 0;
let falsePositive = 0;
let falseNegative = 0;
const failureBreakdown = new Map<string, number>();

for (const [index, item] of cases.entries()) {
  try {
    const candidate = await adapter.detect({
      timezone: 'Asia/Krasnoyarsk',
      members: [
        { externalUserId: '101', firstName: 'Антон', lastName: 'Соколов', username: 'anton' },
        {
          externalUserId: '102',
          firstName: 'Антон',
          lastName: 'Петров',
          username: 'anton.petrov',
        },
        { externalUserId: '103', firstName: 'Алексей', lastName: null, username: 'alexey' },
      ],
      job: {
        sourceMode: 'GROUP_CHAT',
        assignmentStrategy: 'RESOLVE_FROM_TEXT',
        proposalTarget: { type: 'CHAT', externalId: '1' },
        workspaceId: 'eval-workspace',
        chatId: 'eval-chat',
        externalChatId: '1',
        sourceMessageId: item.id,
        sourceSenderId: 'eval-author',
        sourceSenderExternalId: '103',
        occurredAt: '2026-09-20T08:00:00.000Z',
        text: item.text,
        attachmentMetadata: [],
        context: [
          {
            messageId: item.id,
            senderMaxUserId: '103',
            timestamp: '2026-09-20T08:00:00.000Z',
            text: item.text,
          },
        ],
      },
    });
    if (candidate.classification === item.expected.classification) classificationMatches += 1;
    if (candidate.deadlineKind === item.expected.deadlineKind) deadlineMatches += 1;
    if (candidate.expectedResultType === item.expected.expectedResultType) resultMatches += 1;
    const expectedPositive = item.expected.classification === 'ACTIONABLE';
    const actualPositive = candidate.classification === 'ACTIONABLE';
    if (expectedPositive && actualPositive) truePositive += 1;
    if (!expectedPositive && actualPositive) falsePositive += 1;
    if (expectedPositive && !actualPositive) falseNegative += 1;
    if (item.expected.assigneeReferenceOneOf.length > 0) {
      assigneeCases += 1;
      const actual = normalizeReference(candidate.assigneeReference);
      if (
        actual &&
        item.expected.assigneeReferenceOneOf.some(
          (reference) => normalizeReference(reference) === actual,
        )
      ) {
        assigneeMatches += 1;
      }
    }
  } catch (error) {
    schemaFailures += 1;
    if (item.expected.classification === 'ACTIONABLE') falseNegative += 1;
    const reason = describeFailure(error);
    failureBreakdown.set(reason, (failureBreakdown.get(reason) ?? 0) + 1);
  }
  if ((index + 1) % 20 === 0 || index + 1 === cases.length) {
    process.stderr.write(
      `${JSON.stringify({ event: 'gigachat_eval_progress', completed: index + 1, total: cases.length, schemaFailures })}\n`,
    );
  }
}

const denominator = cases.length || 1;
process.stdout.write(
  `${JSON.stringify({ model, cases: cases.length, precision: truePositive / Math.max(1, truePositive + falsePositive), recall: truePositive / Math.max(1, truePositive + falseNegative), classificationAccuracy: classificationMatches / denominator, assigneeExtractionAccuracy: assigneeMatches / Math.max(1, assigneeCases), deadlineAccuracy: deadlineMatches / denominator, resultAccuracy: resultMatches / denominator, hallucinationRate: falsePositive / denominator, schemaFailureRate: schemaFailures / denominator, failureBreakdown: Object.fromEntries(failureBreakdown) }, null, 2)}\n`,
);
if (schemaFailures > 0) process.exitCode = 1;

function normalizeReference(value: string | null): string | null {
  return value?.replace(/^@/u, '').trim().toLocaleLowerCase('ru-RU') ?? null;
}

function describeFailure(error: unknown): string {
  if (!(error instanceof GigaChatDetectionError)) return 'Unexpected evaluation error';
  if (
    error.message === 'GigaChat response failed domain validation' &&
    error.cause instanceof Error
  ) {
    return `${error.message}: ${error.cause.message}`;
  }
  return error.message;
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
