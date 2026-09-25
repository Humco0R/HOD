import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Bot, Keyboard } from '@maxhub/max-bot-api';
import type { Logger } from 'pino';

import type { RedisConnection } from '../../infrastructure/redis/redis';
import type { AttachmentStore, LocalProofStorage } from '../../modules/attachments';
import type { OutboundNotification } from '../../modules/notifications';
import { toSafeErrorLog } from '../../shared/logger';

type MaxAttachments = NonNullable<
  NonNullable<Parameters<Bot['api']['sendMessageToUser']>[2]>['attachments']
>;

export interface MaxScreenStore {
  replace(userId: string, screenKey: string, messageId: string): Promise<string | null>;
}

export class RedisMaxScreenStore implements MaxScreenStore {
  constructor(private readonly redis: RedisConnection) {}

  replace(userId: string, screenKey: string, messageId: string): Promise<string | null> {
    return this.redis.set(`hod:max:screen:${userId}:${screenKey}`, messageId, 'EX', 3600, 'GET');
  }
}

export class MaxNotificationGateway {
  private readonly bot: Bot;

  constructor(
    token: string,
    baseUrl: string,
    private readonly miniAppBotName?: string,
    private readonly attachmentStore?: AttachmentStore,
    private readonly proofStorage?: LocalProofStorage,
    private readonly screens?: MaxScreenStore,
    private readonly logger?: Pick<Logger, 'warn'>,
  ) {
    this.bot = new Bot(token, { clientOptions: { baseUrl } });
  }

  async send(notification: OutboundNotification): Promise<void> {
    const rows = new Map<
      number,
      Array<ReturnType<typeof Keyboard.button.callback> | ReturnType<typeof Keyboard.button.link>>
    >();

    for (const button of notification.buttons) {
      if (
        notification.target.type === 'CHAT' &&
        'payload' in button &&
        button.payload === 'hod:personal:menu'
      ) {
        continue;
      }
      let maxButton:
        | ReturnType<typeof Keyboard.button.callback>
        | ReturnType<typeof Keyboard.button.link>
        | null = null;

      if ('payload' in button && button.payload) {
        maxButton = Keyboard.button.callback(button.text, button.payload);
      }

      if ('startParam' in button && this.miniAppBotName) {
        maxButton = Keyboard.button.link(
          button.text,
          buildMiniAppDeepLink(this.miniAppBotName, button.startParam),
        );
      }

      if (!maxButton) continue;

      const row = button.row ?? 0;

      const currentRow = rows.get(row) ?? [];
      currentRow.push(maxButton);
      rows.set(row, currentRow);
    }

    if (
      notification.target.type === 'USER' &&
      !notification.hideMainMenu &&
      !notification.buttons.some(
        (button) => 'payload' in button && button.payload === 'hod:personal:menu',
      ) &&
      !isMainMenu(notification)
    ) {
      const lastRow = Math.max(-1, ...rows.keys());
      rows.set(lastRow + 1, [Keyboard.button.callback('🏠 Главное меню', 'hod:personal:menu')]);
    }

    const keyboardRows = [...rows.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, buttons]) => buttons);

    const attachments: MaxAttachments = [];
    let text = notification.text;
    if (notification.media) {
      if (!this.attachmentStore || !this.proofStorage) {
        throw new Error('MAX proof storage is not configured');
      }
      const stored = await this.attachmentStore.getForDownload(
        notification.media.attachmentId,
        notification.media.requesterUserId,
      );
      if (!stored) {
        text = 'Материал больше недоступен.';
      } else {
        const content = await this.proofStorage.read(stored.storageKey);
        if (stored.mimeType.startsWith('image/')) {
          const uploaded = await this.bot.api.uploadImage({ source: content });
          attachments.push(uploaded.toJson());
        } else {
          const uploaded = await this.uploadNamedFile(stored.originalName, content);
          attachments.push(uploaded.toJson());
        }
      }
    }
    if (keyboardRows.length) attachments.push(Keyboard.inlineKeyboard(keyboardRows));
    const extra = attachments.length ? { attachments } : undefined;
    const externalId = toSdkId(notification.target.externalId);
    if (notification.target.type === 'CHAT') {
      await this.bot.api.sendMessageToChat(externalId, text, extra);
    } else {
      const message = await this.bot.api.sendMessageToUser(externalId, text, extra);
      if (notification.screen && this.screens && message.body?.mid) {
        try {
          const previous = await this.screens.replace(
            notification.target.externalId,
            notification.screen.key,
            message.body.mid,
          );
          if (notification.screen.replacePrevious && previous && previous !== message.body.mid) {
            const result = await this.bot.api.deleteMessage(previous);
            if (!result.success) {
              this.logger?.warn({ messageId: previous }, 'Failed to delete previous MAX screen');
            }
          }
        } catch (error) {
          this.logger?.warn({ err: toSafeErrorLog(error) }, 'Failed to update previous MAX screen');
        }
      }
    }
  }

  private async uploadNamedFile(name: string, content: Buffer) {
    const directory = await mkdtemp(join(tmpdir(), 'hod-max-proof-'));
    try {
      const filename = sanitizeFilename(name);
      const path = join(directory, filename);
      await writeFile(path, content, { flag: 'wx' });
      return await this.bot.api.uploadFile({ source: path });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function isMainMenu(notification: OutboundNotification): boolean {
  return ['hod:personal:create', 'hod:personal:actions', 'hod:personal:help'].every((payload) =>
    notification.buttons.some((button) => 'payload' in button && button.payload === payload),
  );
}

function sanitizeFilename(value: string): string {
  const filename = [...value.replace(/^.*[\\/]/, '')]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  return filename.slice(0, 255) || 'result.bin';
}

export function buildMiniAppDeepLink(botName: string, startParam: string): string {
  return `https://max.ru/${encodeURIComponent(botName.replace(/^@/, ''))}?startapp=${encodeURIComponent(startParam)}`;
}

function toSdkId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id))
    throw new Error('MAX identifier is outside the SDK safe integer range');
  return id;
}
