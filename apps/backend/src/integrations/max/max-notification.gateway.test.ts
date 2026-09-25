import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { FileAttachment, ImageAttachment, type Bot } from '@maxhub/max-bot-api';
import { describe, expect, it, vi } from 'vitest';

import type { AttachmentStore, LocalProofStorage } from '../../modules/attachments';
import type { OutboundNotification } from '../../modules/notifications';
import { MaxNotificationGateway, type MaxScreenStore } from './max-notification.gateway';

describe('MaxNotificationGateway', () => {
  it('sends a stored photo back into MAX after checking access', async () => {
    const harness = createHarness('image/jpeg');
    const upload = vi
      .spyOn(harness.bot.api, 'uploadImage')
      .mockImplementation(() => Promise.resolve(new ImageAttachment({ token: 'image-token' })));

    await harness.gateway.send(preview());

    expect(harness.getForDownload).toHaveBeenCalledWith('attachment-id', 'user-id');
    expect(upload).toHaveBeenCalledWith({ source: Buffer.from('proof') });
    expect(harness.send).toHaveBeenCalledWith(42, 'Посмотреть результат', {
      attachments: [{ type: 'image', payload: { token: 'image-token' } }, homeKeyboard()],
    });
  });

  it('uploads a stored file with its original name', async () => {
    const harness = createHarness('application/pdf');
    let temporaryPath = '';
    const upload = vi.spyOn(harness.bot.api, 'uploadFile').mockImplementation((options) => {
      temporaryPath = options.source as string;
      return readFile(temporaryPath).then((content) => {
        expect(content).toEqual(Buffer.from('proof'));
        expect(basename(temporaryPath)).toBe('result.pdf');
        return new FileAttachment({ token: 'file-token' });
      });
    });

    const notification = preview();
    notification.buttons = [
      { text: '⬅️ К материалам', payload: 'hod:personal:materials:action:0', row: 0 },
    ];
    await harness.gateway.send(notification);

    expect(upload).toHaveBeenCalledOnce();
    expect(existsSync(temporaryPath)).toBe(false);
    expect(harness.send.mock.lastCall?.[2]?.attachments).toEqual(
      expect.arrayContaining([{ type: 'file', payload: { token: 'file-token' } }]),
    );
    expect(harness.send.mock.lastCall?.[2]?.attachments).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'inline_keyboard' })]),
    );
  });

  it('does not upload a material after access has been revoked', async () => {
    const harness = createHarness('application/pdf');
    harness.getForDownload.mockResolvedValue(null);
    const upload = vi.spyOn(harness.bot.api, 'uploadFile');

    await harness.gateway.send(preview());

    expect(upload).not.toHaveBeenCalled();
    expect(harness.read).not.toHaveBeenCalled();
    expect(harness.send).toHaveBeenCalledWith(42, 'Материал больше недоступен.', {
      attachments: [homeKeyboard()],
    });
  });

  it('adds one home button to personal notifications after a task is accepted', async () => {
    const harness = createHarness('application/pdf', 'hod-bot');
    await harness.gateway.send({
      target: { type: 'USER', externalId: '42' },
      text: 'Дело принято',
      buttons: [{ text: 'Открыть', startParam: 'action_1' }],
    });
    expect(harness.send.mock.lastCall?.[2]?.attachments).toEqual([
      {
        type: 'inline_keyboard',
        payload: {
          buttons: [
            [{ type: 'link', text: 'Открыть', url: 'https://max.ru/hod-bot?startapp=action_1' }],
            [{ type: 'callback', text: '🏠 Главное меню', payload: 'hod:personal:menu' }],
          ],
        },
      },
    ]);

    await harness.gateway.send({
      target: { type: 'USER', externalId: '42' },
      text: 'Дело принято',
      buttons: [{ text: '🏠 Главное меню', payload: 'hod:personal:menu' }],
    });
    expect(harness.send.mock.lastCall?.[2]?.attachments).toEqual([homeKeyboard()]);
  });

  it('sends a review notice as plain text when navigation is hidden', async () => {
    const harness = createHarness('application/pdf');

    await harness.gateway.send({
      target: { type: 'USER', externalId: '42' },
      text: 'Дело поступило на проверку',
      buttons: [],
      hideMainMenu: true,
    });

    expect(harness.send).toHaveBeenCalledExactlyOnceWith(
      42,
      'Дело поступило на проверку',
      undefined,
    );
  });

  it('does not send personal navigation to a group chat', async () => {
    const harness = createHarness('application/pdf');
    const sendToChat = vi
      .spyOn(harness.bot.api, 'sendMessageToChat')
      .mockResolvedValue({} as Awaited<ReturnType<Bot['api']['sendMessageToChat']>>);

    await harness.gateway.send({
      target: { type: 'CHAT', externalId: '900' },
      text: 'Дело создано',
      buttons: [{ text: '🏠 Главное меню', payload: 'hod:personal:menu' }],
    });

    expect(sendToChat).toHaveBeenCalledWith(900, 'Дело создано', undefined);
  });

  it('removes the previous create prompt after a text response', async () => {
    const replace = vi
      .fn<MaxScreenStore['replace']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('previous-prompt');
    const harness = createHarness('application/pdf', undefined, { replace });
    const remove = vi.spyOn(harness.bot.api, 'deleteMessage').mockResolvedValue({ success: true });
    harness.send
      .mockResolvedValueOnce({ body: { mid: 'previous-prompt' } } as Awaited<
        ReturnType<Bot['api']['sendMessageToUser']>
      >)
      .mockResolvedValueOnce({ body: { mid: 'next-prompt' } } as Awaited<
        ReturnType<Bot['api']['sendMessageToUser']>
      >);

    const notification: OutboundNotification = {
      target: { type: 'USER', externalId: '42' },
      text: 'Название дела',
      buttons: [],
      screen: { key: 'draft-1', replacePrevious: false },
    };
    await harness.gateway.send(notification);
    expect(remove).not.toHaveBeenCalled();

    await harness.gateway.send({
      ...notification,
      text: 'Описание дела',
      screen: { key: 'draft-1', replacePrevious: true },
    });
    expect(replace).toHaveBeenNthCalledWith(2, '42', 'draft-1', 'next-prompt');
    expect(remove).toHaveBeenCalledExactlyOnceWith('previous-prompt');
  });
});

function homeKeyboard() {
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [[{ type: 'callback', text: '🏠 Главное меню', payload: 'hod:personal:menu' }]],
    },
  };
}

function createHarness(mimeType: string, miniAppBotName?: string, screenStore?: MaxScreenStore) {
  const getForDownload = vi.fn<AttachmentStore['getForDownload']>(() =>
    Promise.resolve({
      id: 'attachment-id',
      storageKey: 'stored-key',
      originalName: mimeType.startsWith('image/') ? 'photo.jpg' : 'result.pdf',
      mimeType,
    }),
  );
  const read = vi.fn<LocalProofStorage['read']>(() => Promise.resolve(Buffer.from('proof')));
  const gateway = new MaxNotificationGateway(
    'test-token',
    'https://platform-api2.max.ru',
    miniAppBotName,
    { getForDownload } as unknown as AttachmentStore,
    { read } as unknown as LocalProofStorage,
    screenStore,
  );
  const bot = (gateway as unknown as { bot: Bot }).bot;
  const send = vi
    .spyOn(bot.api, 'sendMessageToUser')
    .mockImplementation(() =>
      Promise.resolve({} as Awaited<ReturnType<Bot['api']['sendMessageToUser']>>),
    );
  return { gateway, bot, getForDownload, read, send };
}

function preview(): OutboundNotification {
  return {
    target: { type: 'USER', externalId: '42' },
    text: 'Посмотреть результат',
    buttons: [],
    media: { attachmentId: 'attachment-id', requesterUserId: 'user-id' },
  };
}
