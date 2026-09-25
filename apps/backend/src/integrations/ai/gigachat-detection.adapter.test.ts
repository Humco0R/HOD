import GigaChat from 'gigachat';
import { describe, expect, it, vi } from 'vitest';

import type { AiDetectionInput } from '../../modules/detections';
import {
  buildGigaChatClientConfig,
  GigaChatDetectionAdapter,
  GigaChatDetectionError,
  isGigaChatAuthorizationKey,
  normalizeGigaChatBaseUrl,
} from './gigachat-detection.adapter';

const testCredentials = Buffer.from('test-client:test-secret').toString('base64');

describe('GigaChatDetectionAdapter', () => {
  it('initializes the official SDK with backend-only settings and millisecond timeout', () => {
    const options = providerOptions();
    const client = new GigaChat(buildGigaChatClientConfig(options));

    expect(client._settings).toMatchObject({
      credentials: testCredentials,
      scope: 'GIGACHAT_API_B2B',
      model: 'GigaChat-2-Pro',
      baseUrl: 'https://api.giga.chat/v1',
      timeout: 60,
    });
    expect(normalizeGigaChatBaseUrl('https://example.test/custom/v1/')).toBe(
      'https://example.test/custom/v1',
    );
    expect(isGigaChatAuthorizationKey(testCredentials)).toBe(true);
    expect(isGigaChatAuthorizationKey('access.token.value')).toBe(false);
  });

  it('maps messages and JSON Schema response format, then validates the response locally', async () => {
    const chat = vi.fn((request: Record<string, unknown>) => {
      void request;
      return Promise.resolve({
        choices: [{ message: { content: JSON.stringify(providerOutput()) } }],
        model: 'GigaChat-2-Pro',
        xHeaders: { xRequestID: 'request-1' },
      });
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const adapter = new GigaChatDetectionAdapter(providerOptions(), { chat }, logger);

    await expect(adapter.detect(input)).resolves.toMatchObject({
      classification: 'ACTIONABLE',
      deadlineKind: 'DEPENDENCY',
      raw: {
        adapter: 'gigachat',
        model: 'GigaChat-2-Pro',
        promptVersion: 'hod-detection-v2',
      },
    });
    const request = chat.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string; strict: boolean; schema: Record<string, unknown> };
    };
    expect(request.messages[0]).toMatchObject({ role: 'system' });
    expect(request.messages[0]?.content).toContain('Отвечай на русском языке');
    expect(request.messages[1]?.content).toContain('Asia/Krasnoyarsk');
    expect(request.response_format.type).toBe('json_schema');
    expect(request.response_format.strict).toBe(true);
    expect(request.response_format.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gigachat', success: true, request_id: 'request-1' }),
      'GigaChat request completed',
    );
  });

  it('marks only the new group message as the detection target', async () => {
    const chat = vi.fn((request: Record<string, unknown>) => {
      void request;
      return Promise.resolve({
        choices: [{ message: { content: JSON.stringify(providerOutput()) } }],
        model: 'GigaChat-2-Pro',
      });
    });
    const adapter = new GigaChatDetectionAdapter(providerOptions(), { chat });
    await adapter.detect({
      ...input,
      job: {
        ...input.job,
        sourceMessageId: 'message-2',
        text: '🤣',
        context: [
          input.job.context[0]!,
          {
            messageId: 'message-2',
            senderMaxUserId: '1',
            timestamp: '2026-09-20T08:01:00.000Z',
            text: '🤣',
          },
        ],
      },
    });

    const request = chat.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const prompt = JSON.parse(request.messages[1]!.content) as {
      previousMessages: Array<{ messageId: string; text: string }>;
      triggerMessage: { messageId: string; text: string };
    };
    expect(request.messages[0]?.content).toContain('Классифицируй только triggerMessage.text');
    expect(prompt.previousMessages).toMatchObject([
      { messageId: 'message-1', text: 'Антон, завтра после Кирова проверь кондиционер' },
    ]);
    expect(prompt.triggerMessage).toMatchObject({ messageId: 'message-2', text: '🤣' });
  });

  it('rejects empty, invalid JSON, invalid schema and contradictory domain output', async () => {
    for (const content of [
      undefined,
      'not-json',
      JSON.stringify({ classification: 'ACTIONABLE' }),
    ]) {
      const adapter = adapterReturning(content);
      await expect(adapter.detect(input)).rejects.toBeInstanceOf(GigaChatDetectionError);
    }

    const contradictory = adapterReturning(
      JSON.stringify(providerOutput({ deadlineAt: '2026-09-21T15:00:00Z' })),
    );
    await expect(contradictory.detect(input)).rejects.toMatchObject({
      message: 'GigaChat response failed domain validation',
      errorType: 'invalid_response',
    });
  });

  it('retries temporary provider errors with exponential backoff and maps the success', async () => {
    const temporaryError = Object.assign(new Error('temporary'), { response: { status: 503 } });
    const chat = vi
      .fn()
      .mockRejectedValueOnce(temporaryError)
      .mockRejectedValueOnce(temporaryError)
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(providerOutput()) } }],
        model: 'GigaChat-2-Pro',
      });
    const sleep = vi.fn(() => Promise.resolve());
    const adapter = new GigaChatDetectionAdapter(providerOptions(), { chat }, undefined, sleep);

    await expect(adapter.detect(input)).resolves.toMatchObject({ classification: 'ACTIONABLE' });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it('does not retry authorization errors and exposes no provider response details', async () => {
    const chat = vi.fn(() =>
      Promise.reject(Object.assign(new Error('secret OAuth body'), { response: { status: 401 } })),
    );
    const adapter = new GigaChatDetectionAdapter(providerOptions(), { chat });

    await expect(adapter.detect(input)).rejects.toMatchObject({
      message: 'GigaChat authorization failed',
      errorType: 'authorization',
      status: 401,
    });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('limits timeout retries to three attempts and returns a controlled error', async () => {
    const chat = vi.fn(() =>
      Promise.reject(Object.assign(new Error('socket details'), { code: 'ETIMEDOUT' })),
    );
    const sleep = vi.fn(() => Promise.resolve());
    const adapter = new GigaChatDetectionAdapter(providerOptions(), { chat }, undefined, sleep);

    await expect(adapter.detect(input)).rejects.toMatchObject({
      message: 'GigaChat request timed out',
      errorType: 'timeout',
    });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });
});

function providerOptions() {
  return {
    credentials: testCredentials,
    scope: 'GIGACHAT_API_B2B' as const,
    model: 'GigaChat-2-Pro',
    baseUrl: 'https://api.giga.chat',
    timeoutMs: 60_000,
  };
}

function adapterReturning(content: string | undefined): GigaChatDetectionAdapter {
  return new GigaChatDetectionAdapter(providerOptions(), {
    chat: () =>
      Promise.resolve({
        choices: [{ message: content === undefined ? {} : { content } }],
        model: 'GigaChat-2-Pro',
      }),
  });
}

function providerOutput(override: Record<string, unknown> = {}) {
  return {
    classification: 'ACTIONABLE',
    title: 'Проверить кондиционер',
    assigneeReference: 'Антон',
    deadlineKind: 'DEPENDENCY',
    deadlineAt: null,
    deadlineDate: null,
    deadlineDependency: 'после Кирова',
    deadlineRaw: 'завтра после Кирова',
    expectedResultType: 'PHOTO',
    expectedResultText: 'Фото результата',
    location: 'Пушкина',
    confidence: 0.93,
    ...override,
  };
}

const input: AiDetectionInput = {
  timezone: 'Asia/Krasnoyarsk',
  members: [{ externalUserId: '1', firstName: 'Антон', lastName: null, username: 'anton' }],
  job: {
    sourceMode: 'GROUP_CHAT',
    assignmentStrategy: 'RESOLVE_FROM_TEXT',
    proposalTarget: { type: 'CHAT', externalId: '100' },
    workspaceId: 'workspace-1',
    chatId: 'chat-1',
    externalChatId: '100',
    sourceMessageId: 'message-1',
    sourceSenderId: 'user-1',
    sourceSenderExternalId: '1',
    occurredAt: '2026-09-20T08:00:00.000Z',
    text: 'Антон, завтра после Кирова проверь кондиционер',
    attachmentMetadata: [],
    context: [
      {
        messageId: 'message-1',
        senderMaxUserId: '1',
        timestamp: '2026-09-20T08:00:00.000Z',
        text: 'Антон, завтра после Кирова проверь кондиционер',
      },
    ],
  },
};
