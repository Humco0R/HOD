import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DetectionAccessDeniedError } from '../../modules/detections';
import type { InboundChatEventHandler } from '../../modules/workspaces';
import { MaxUpdateRouter } from './max-update.router';
import { isWebhookSecretValid, registerMaxWebhookRoute } from './max-webhook.routes';
import type { UpdateDeduplicator } from './update-deduplicator';

class MemoryDeduplicator implements UpdateDeduplicator {
  private readonly completed = new Set<string>();

  async execute(key: string, operation: () => Promise<void>): Promise<boolean> {
    if (this.completed.has(key)) return false;
    this.completed.add(key);
    try {
      await operation();
      return true;
    } catch (error) {
      this.completed.delete(key);
      throw error;
    }
  }
}

const update = {
  update_type: 'message_created',
  timestamp: 1_758_000_000_000,
  message: {
    sender: {
      user_id: 42,
      name: 'Иван',
      first_name: 'Иван',
      username: 'ivan',
      is_bot: false,
      last_activity_time: 1_758_000_000_000,
    },
    recipient: { chat_id: 77, chat_type: 'chat', post_id: null },
    timestamp: 1_758_000_000_000,
    body: { mid: 'message-1', seq: 1, text: 'Проверить объект' },
  },
};

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp(
  handler: InboundChatEventHandler,
  configure?: (router: MaxUpdateRouter) => void,
) {
  const app = Fastify({ logger: false });
  const router = new MaxUpdateRouter(
    'test-token',
    'https://platform-api2.max.ru',
    handler,
    new MemoryDeduplicator(),
  );
  configure?.(router);
  registerMaxWebhookRoute(app, { path: '/max/webhook', secret: 'secret_123', router });
  apps.push(app);
  return app;
}

function callbackUpdate(chatType: 'dialog' | 'chat') {
  return {
    update_type: 'message_callback',
    timestamp: 1_758_000_000_003,
    callback: {
      timestamp: 1_758_000_000_003,
      callback_id: `callback-${chatType}`,
      payload: 'hod:action:accept:00000000-0000-4000-8000-000000000001',
      user: update.message.sender,
    },
    message: {
      ...update.message,
      recipient: { chat_id: 900, chat_type: chatType, user_id: 42 },
    },
  };
}

describe('MAX webhook', () => {
  it('validates the exact secret header semantics', () => {
    expect(isWebhookSecretValid('secret_123', 'secret_123')).toBe(true);
    expect(isWebhookSecretValid(undefined, 'secret_123')).toBe(false);
    expect(isWebhookSecretValid(['secret_123'], 'secret_123')).toBe(false);
    expect(isWebhookSecretValid('secret_124', 'secret_123')).toBe(false);
  });

  it('routes a representative update through SDK Context/Composer exactly once', async () => {
    const handle = vi.fn<InboundChatEventHandler['handle']>().mockResolvedValue(undefined);
    const app = createApp({ handle });

    const first = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'X-Max-Bot-Api-Secret': 'secret_123' },
      payload: update,
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: update,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true, result: 'processed' });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({ ok: true, result: 'duplicate' });
    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'message.created',
        externalChatId: '77',
        externalMessageId: 'message-1',
      }),
    );
  });

  it('routes bot start and a forwarded direct message without returning 400', async () => {
    const handle = vi.fn<InboundChatEventHandler['handle']>().mockResolvedValue(undefined);
    const app = createApp({ handle });
    const user = {
      user_id: 42,
      name: 'Иван',
      first_name: 'Иван',
      is_bot: false,
      last_activity_time: 1_758_000_000_000,
    };
    const started = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: {
        update_type: 'bot_started',
        timestamp: 1_758_000_000_001,
        chat_id: 900,
        user,
      },
    });
    const forwarded = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: {
        update_type: 'message_created',
        timestamp: 1_758_000_000_002,
        message: {
          ...update.message,
          sender: user,
          recipient: { chat_id: 900, chat_type: 'dialog', user_id: 777 },
          body: null,
          link: {
            type: 'forward',
            message: { mid: 'original-1', seq: 1, text: 'Проверь кондиционер' },
          },
        },
      },
    });

    expect(started.statusCode).toBe(200);
    expect(forwarded.statusCode).toBe(200);
    expect(handle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: 'personal.started', externalDialogId: '900' }),
    );
    expect(handle.mock.calls[1]?.[0]).toMatchObject({
      kind: 'personal.message.created',
      externalMessageId: 'original-1',
      forwardedMessage: { messageId: 'original-1' },
    });
  });

  it('acknowledges a direct-dialog callback and removes the previous bot screen', async () => {
    const handle = vi.fn<InboundChatEventHandler['handle']>().mockResolvedValue(undefined);
    let acknowledgedCallbackId: string | undefined;
    let acknowledgement: unknown;
    let deletedMessageId: string | undefined;
    const app = createApp({ handle }, (router) => {
      vi.spyOn(router.bot.api, 'answerOnCallback').mockImplementation((callbackId, extra) => {
        acknowledgedCallbackId = callbackId;
        acknowledgement = extra;
        return Promise.resolve({ success: true });
      });
      vi.spyOn(router.bot.api, 'deleteMessage').mockImplementation((messageId) => {
        deletedMessageId = messageId;
        return Promise.resolve({ success: true });
      });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: callbackUpdate('dialog'),
    });

    expect(response.statusCode).toBe(200);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message.callback', externalChatId: null }),
    );
    expect(acknowledgedCallbackId).toBe('callback-dialog');
    expect(acknowledgement).toEqual({
      message: {
        text: '✅ Поручение принято\n\nПроверить объект',
        attachments: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [
                [{ type: 'callback', text: '🏠 Главное меню', payload: 'hod:personal:menu' }],
              ],
            },
          },
        ],
      },
    });
    expect(deletedMessageId).toBe('message-1');
  });

  it('preserves the group id and removes the previous bot message', async () => {
    const handle = vi.fn<InboundChatEventHandler['handle']>().mockResolvedValue(undefined);
    let deletedMessageId: string | undefined;
    let acknowledgement: unknown;
    const app = createApp({ handle }, (router) => {
      vi.spyOn(router.bot.api, 'answerOnCallback').mockImplementation((_callbackId, extra) => {
        acknowledgement = extra;
        return Promise.resolve({ success: true });
      });
      vi.spyOn(router.bot.api, 'deleteMessage').mockImplementation((messageId) => {
        deletedMessageId = messageId;
        return Promise.resolve({ success: true });
      });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: callbackUpdate('chat'),
    });

    expect(response.statusCode).toBe(200);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message.callback', externalChatId: '900' }),
    );
    expect(deletedMessageId).toBe('message-1');
    expect(acknowledgement).toEqual({
      message: { text: 'Проверить объект', attachments: [] },
    });
  });

  it.each(['dialog', 'chat'] as const)(
    'processes only the first click on one %s message even with new callback IDs',
    async (chatType) => {
      const handle = vi.fn<InboundChatEventHandler['handle']>().mockResolvedValue(undefined);
      const answer = vi.fn().mockResolvedValue({ success: true });
      const remove = vi.fn().mockResolvedValue({ success: true });
      const app = createApp({ handle }, (router) => {
        vi.spyOn(router.bot.api, 'answerOnCallback').mockImplementation(answer);
        vi.spyOn(router.bot.api, 'deleteMessage').mockImplementation(remove);
      });
      const firstUpdate = callbackUpdate(chatType);
      const secondUpdate = callbackUpdate(chatType);
      secondUpdate.callback.callback_id = `another-click-${chatType}`;

      const first = await app.inject({
        method: 'POST',
        url: '/max/webhook',
        headers: { 'x-max-bot-api-secret': 'secret_123' },
        payload: firstUpdate,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/max/webhook',
        headers: { 'x-max-bot-api-secret': 'secret_123' },
        payload: secondUpdate,
      });

      expect(first.json()).toEqual({ ok: true, result: 'processed' });
      expect(second.json()).toEqual({ ok: true, result: 'duplicate' });
      expect(handle).toHaveBeenCalledOnce();
      expect(answer).toHaveBeenCalledTimes(2);
      expect(answer).toHaveBeenNthCalledWith(2, `another-click-${chatType}`);
      expect(remove).toHaveBeenCalledOnce();

      const newScreenUpdate = callbackUpdate(chatType);
      newScreenUpdate.callback.callback_id = `new-screen-${chatType}`;
      newScreenUpdate.message.body = { ...newScreenUpdate.message.body, mid: 'message-2' };
      const newScreen = await app.inject({
        method: 'POST',
        url: '/max/webhook',
        headers: { 'x-max-bot-api-secret': 'secret_123' },
        payload: newScreenUpdate,
      });
      expect(newScreen.json()).toEqual({ ok: true, result: 'processed' });
      expect(handle).toHaveBeenCalledTimes(2);
    },
  );

  it('ignores simultaneous clicks on the same group message', async () => {
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const handle = vi.fn<InboundChatEventHandler['handle']>().mockImplementation(async () => {
      markStarted();
      await firstCanFinish;
    });
    const app = createApp({ handle }, (router) => {
      vi.spyOn(router.bot.api, 'answerOnCallback').mockResolvedValue({ success: true });
      vi.spyOn(router.bot.api, 'deleteMessage').mockResolvedValue({ success: true });
    });
    const firstUpdate = callbackUpdate('chat');
    const secondUpdate = callbackUpdate('chat');
    secondUpdate.callback.callback_id = 'rapid-second-click';

    const firstResponse = app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: firstUpdate,
    });
    await firstStarted;
    const duplicate = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: secondUpdate,
    });
    expect(duplicate.json()).toEqual({ ok: true, result: 'duplicate' });
    releaseFirst();
    expect((await firstResponse).json()).toEqual({ ok: true, result: 'processed' });
    expect(handle).toHaveBeenCalledOnce();
  });

  it('keeps the group proposal when another member presses its button', async () => {
    const handle = vi
      .fn<InboundChatEventHandler['handle']>()
      .mockRejectedValueOnce(new DetectionAccessDeniedError())
      .mockRejectedValueOnce(new DetectionAccessDeniedError())
      .mockResolvedValue(undefined);
    const answer = vi.fn().mockResolvedValue({ success: true });
    const remove = vi.fn().mockResolvedValue({ success: true });
    const tellUser = vi.fn().mockResolvedValue({});
    const app = createApp({ handle }, (router) => {
      vi.spyOn(router.bot.api, 'answerOnCallback').mockImplementation(answer);
      vi.spyOn(router.bot.api, 'deleteMessage').mockImplementation(remove);
      vi.spyOn(router.bot.api, 'sendMessageToUser').mockImplementation(tellUser);
    });

    const unauthorizedUpdate = callbackUpdate('chat');
    unauthorizedUpdate.callback.user = { ...update.message.sender, user_id: 43 };
    const response = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: unauthorizedUpdate,
    });

    expect(response.json()).toEqual({ ok: true, result: 'processed' });
    expect(tellUser).toHaveBeenCalledWith(
      43,
      'Управлять предложением может только автор сообщения.',
    );
    expect(answer).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    const repeatedUnauthorized = callbackUpdate('chat');
    repeatedUnauthorized.callback.callback_id = 'callback-unauthorized-again';
    repeatedUnauthorized.callback.user = { ...update.message.sender, user_id: 43 };
    const repeatedResponse = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: repeatedUnauthorized,
    });
    expect(repeatedResponse.json()).toEqual({ ok: true, result: 'duplicate' });
    expect(tellUser).toHaveBeenCalledOnce();
    expect(answer).toHaveBeenCalledExactlyOnceWith('callback-unauthorized-again');

    const authorUpdate = callbackUpdate('chat');
    authorUpdate.callback.callback_id = 'callback-author';
    const authorResponse = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: authorUpdate,
    });
    expect(authorResponse.json()).toEqual({ ok: true, result: 'processed' });
    expect(handle).toHaveBeenCalledTimes(3);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('does not run personal callbacks from an old group message', async () => {
    const handle = vi.fn<InboundChatEventHandler['handle']>().mockResolvedValue(undefined);
    const answer = vi.fn().mockResolvedValue({ success: true });
    const remove = vi.fn().mockResolvedValue({ success: true });
    const app = createApp({ handle }, (router) => {
      vi.spyOn(router.bot.api, 'answerOnCallback').mockImplementation(answer);
      vi.spyOn(router.bot.api, 'deleteMessage').mockImplementation(remove);
    });
    const update = callbackUpdate('chat');
    update.callback.payload = 'hod:personal:menu';

    const response = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: update,
    });

    expect(response.statusCode).toBe(200);
    expect(handle).not.toHaveBeenCalled();
    expect(answer).toHaveBeenCalledWith('callback-chat', {
      message: { text: 'Проверить объект', attachments: [] },
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith('message-1');
  });

  it('does not reprocess a callback when MAX cannot remove the previous screen', async () => {
    const handle = vi.fn<InboundChatEventHandler['handle']>().mockResolvedValue(undefined);
    const app = createApp({ handle }, (router) => {
      vi.spyOn(router.bot.api, 'answerOnCallback').mockResolvedValue({ success: true });
      vi.spyOn(router.bot.api, 'deleteMessage').mockRejectedValue(new Error('MAX unavailable'));
    });

    const request = {
      method: 'POST' as const,
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: callbackUpdate('dialog'),
    };
    const first = await app.inject(request);
    const duplicate = await app.inject(request);

    expect(first.json()).toEqual({ ok: true, result: 'processed' });
    expect(duplicate.json()).toEqual({ ok: true, result: 'duplicate' });
    expect(handle).toHaveBeenCalledOnce();
  });

  it('removes the previous screen even if MAX rejects the callback acknowledgement', async () => {
    const handle = vi.fn<InboundChatEventHandler['handle']>().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue({ success: true });
    const app = createApp({ handle }, (router) => {
      vi.spyOn(router.bot.api, 'answerOnCallback').mockRejectedValue(new Error('Expired callback'));
      vi.spyOn(router.bot.api, 'deleteMessage').mockImplementation(remove);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: callbackUpdate('dialog'),
    });

    expect(response.json()).toEqual({ ok: true, result: 'processed' });
    expect(remove).toHaveBeenCalledExactlyOnceWith('message-1');
  });

  it('rejects a bad secret and asks MAX to retry transient processing failures', async () => {
    const handle = vi
      .fn<InboundChatEventHandler['handle']>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(undefined);
    const app = createApp({ handle });

    const unauthorized = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'wrong' },
      payload: update,
    });
    const failed = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: update,
    });
    const retry = await app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: { 'x-max-bot-api-secret': 'secret_123' },
      payload: update,
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(failed.statusCode).toBe(503);
    expect(retry.statusCode).toBe(200);
    expect(handle).toHaveBeenCalledTimes(2);
  });
});
