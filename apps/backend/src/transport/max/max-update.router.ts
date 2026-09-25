import { Bot, Context, Keyboard } from '@maxhub/max-bot-api';
import type { Update } from '@maxhub/max-bot-api/types';
import type { Logger } from 'pino';

import type { InboundChatEvent, InboundChatEventHandler } from '../../modules/workspaces';
import { DetectionAccessDeniedError } from '../../modules/detections';
import { toExternalUser } from '../../integrations/max/max-chat-directory.gateway';
import { toSafeErrorLog } from '../../shared/logger';
import {
  maxUpdateEnvelopeSchema,
  supportedMaxUpdateSchema,
  type SupportedMaxUpdate,
} from './max-update.schema';
import type { UpdateDeduplicator } from './update-deduplicator';

const deduplicationResult = Symbol('max-update-deduplication-result');

export type MaxDispatchResult = 'processed' | 'duplicate' | 'ignored';

export class InvalidMaxUpdateError extends Error {}

export class MaxUpdateRouter {
  readonly bot: Bot;

  constructor(
    token: string,
    baseUrl: string,
    private readonly handler: InboundChatEventHandler,
    private readonly deduplicator: UpdateDeduplicator,
    private readonly logger?: Pick<Logger, 'warn'>,
  ) {
    this.bot = new Bot(token, { clientOptions: { baseUrl } });
    this.bot.use(async (context, next) => {
      const processed = await this.deduplicator.execute(updateKey(context.update), next);
      context.state[deduplicationResult] = processed ? 'processed' : 'duplicate';
    });
    this.registerHandlers();
  }

  async dispatch(value: unknown): Promise<MaxDispatchResult> {
    const envelope = maxUpdateEnvelopeSchema.safeParse(value);
    if (!envelope.success) throw new InvalidMaxUpdateError('Invalid MAX update envelope');
    const parsed = supportedMaxUpdateSchema.safeParse(value);
    if (!parsed.success) {
      if (isSupportedType(envelope.data.update_type)) {
        throw new InvalidMaxUpdateError('Invalid MAX update payload');
      }
      return 'ignored';
    }

    const context = new Context(parsed.data as unknown as Update, this.bot.api, this.bot.botInfo);
    try {
      await this.bot.middleware()(context, () => Promise.resolve());
    } catch (error) {
      if (
        !(error instanceof DetectionAccessDeniedError) ||
        parsed.data.update_type !== 'message_callback'
      ) {
        throw error;
      }
      const deniedUserId = parsed.data.callback.user.user_id;
      const deniedCallbackId = parsed.data.callback.callback_id;
      const notified = await this.deduplicator.execute(
        `unauthorized:${updateKey(parsed.data)}:${deniedUserId}`,
        async () => {
          try {
            await this.bot.api.sendMessageToUser(
              deniedUserId,
              'Управлять предложением может только автор сообщения.',
            );
          } catch (notificationError) {
            this.logger?.warn(
              { err: toSafeErrorLog(notificationError) },
              'Failed to notify unauthorized MAX callback actor',
            );
          }
        },
      );
      if (!notified) await this.acknowledgeDuplicate(deniedCallbackId);
      return notified ? 'processed' : 'duplicate';
    }
    const result =
      (context.state[deduplicationResult] as MaxDispatchResult | undefined) ?? 'processed';
    if (result === 'duplicate' && parsed.data.update_type === 'message_callback') {
      await this.acknowledgeDuplicate(parsed.data.callback.callback_id);
    }
    return result;
  }

  private async acknowledgeDuplicate(callbackId: string): Promise<void> {
    try {
      await this.bot.api.answerOnCallback(callbackId);
    } catch (error) {
      this.logger?.warn(
        { err: toSafeErrorLog(error) },
        'Failed to acknowledge duplicate MAX callback',
      );
    }
  }

  private registerHandlers(): void {
    this.bot.on('bot_started', async (context) => this.handler.handle(normalize(context.update)));
    this.bot.on('bot_added', async (context) => this.handler.handle(normalize(context.update)));
    this.bot.on('bot_removed', async (context) => this.handler.handle(normalize(context.update)));
    this.bot.on('chat_title_changed', async (context) =>
      this.handler.handle(normalize(context.update)),
    );
    this.bot.on('user_added', async (context) => this.handler.handle(normalize(context.update)));
    this.bot.on('user_removed', async (context) => this.handler.handle(normalize(context.update)));
    this.bot.on('message_created', async (context) =>
      this.handler.handle(normalize(context.update)),
    );
    this.bot.on('message_callback', async (context) => {
      const update = context.update;
      const isPersonalDialog = update.message?.recipient.chat_type === 'dialog';
      if (isPersonalDialog || !update.callback.payload?.startsWith('hod:personal:')) {
        await this.handler.handle(normalize(update));
      }
      const status = callbackAcknowledgementText(update);
      const originalText = update.message?.body?.text?.trim();
      try {
        const result = await context.answerOnCallback({
          message: isPersonalDialog
            ? {
                text: originalText ? `${status}\n\n${originalText}` : status,
                attachments: [
                  Keyboard.inlineKeyboard([
                    [Keyboard.button.callback('🏠 Главное меню', 'hod:personal:menu')],
                  ]),
                ],
              }
            : { text: originalText || status, attachments: [] },
        });
        if (!result.success) this.logger?.warn('Failed to acknowledge MAX callback');
      } catch (error) {
        this.logger?.warn({ err: toSafeErrorLog(error) }, 'Failed to acknowledge MAX callback');
      }
      if (update.message?.body?.mid) {
        try {
          const result = await context.deleteMessage(update.message.body.mid);
          if (!result.success) {
            this.logger?.warn(
              { messageId: update.message.body.mid },
              'Failed to delete previous MAX bot message',
            );
          }
        } catch (error) {
          this.logger?.warn(
            { err: toSafeErrorLog(error), messageId: update.message.body.mid },
            'Failed to delete previous MAX bot message',
          );
        }
      }
    });
  }
}

function callbackAcknowledgementText(
  update: Extract<SupportedMaxUpdate, { update_type: 'message_callback' }>,
): string {
  const statusByOperation: Record<string, string> = {
    'detection:confirm': '✅ Поручение создано',
    'detection:reject': 'Отклонено',
    'action:accept': '✅ Поручение принято',
    'action:start': '▶️ Работа начата',
    'action:submit': '📝 Подготовка результата',
    'action:verify': '✅ Результат принят',
    'action:cancel': '🗑 Дело удалено',
  };
  const operation = update.callback.payload?.match(/^hod:([^:]+:[^:]+):/)?.[1];
  const status = operation ? statusByOperation[operation] : undefined;
  return status ?? '✅ Готово';
}

function isSupportedType(value: string): boolean {
  return [
    'bot_added',
    'bot_started',
    'bot_removed',
    'chat_title_changed',
    'user_added',
    'user_removed',
    'message_created',
    'message_callback',
  ].includes(value);
}

function updateKey(update: SupportedMaxUpdate | Update): string {
  switch (update.update_type) {
    case 'message_created':
      return `message:${update.message.body?.mid ?? update.message.link?.message.mid ?? update.timestamp}`;
    case 'message_callback':
      return update.message?.body?.mid
        ? `callback-message:${update.message.recipient.chat_type}:${update.message.recipient.chat_id ?? update.callback.user.user_id}:${update.message.body.mid}`
        : `callback:${update.callback.callback_id}`;
    default:
      return `${update.update_type}:${update.timestamp}:${'chat_id' in update ? update.chat_id : ''}:${'user' in update ? update.user.user_id : ''}`;
  }
}

function normalize(update: SupportedMaxUpdate): InboundChatEvent {
  const occurredAt = new Date(update.timestamp);
  switch (update.update_type) {
    case 'bot_started':
      return {
        kind: 'personal.started',
        eventId: updateKey(update),
        occurredAt,
        externalDialogId: String(update.chat_id),
        actor: toExternalUser(update.user),
      };
    case 'bot_added':
      return {
        kind: 'bot.added',
        eventId: updateKey(update),
        occurredAt,
        externalChatId: String(update.chat_id),
        actor: toExternalUser(update.user),
      };
    case 'bot_removed':
      return {
        kind: 'bot.removed',
        eventId: updateKey(update),
        occurredAt,
        externalChatId: String(update.chat_id),
      };
    case 'chat_title_changed':
      return {
        kind: 'chat.title-changed',
        eventId: updateKey(update),
        occurredAt,
        externalChatId: String(update.chat_id),
        title: update.title,
        actor: toExternalUser(update.user),
      };
    case 'user_added':
      return {
        kind: 'member.added',
        eventId: updateKey(update),
        occurredAt,
        externalChatId: String(update.chat_id),
        member: toExternalUser(update.user),
      };
    case 'user_removed':
      return {
        kind: 'member.removed',
        eventId: updateKey(update),
        occurredAt,
        externalChatId: String(update.chat_id),
        memberExternalUserId: String(update.user.user_id),
      };
    case 'message_created': {
      const chatId = update.message.recipient.chat_id;
      const author = update.message.sender;
      if (!author) throw new InvalidMaxUpdateError('Message lacks sender');
      if (update.message.recipient.chat_type === 'dialog') {
        const forwarded = update.message.link?.type === 'forward' ? update.message.link : null;
        const messageId = update.message.body?.mid ?? forwarded?.message.mid;
        if (!messageId) throw new InvalidMaxUpdateError('Direct message lacks an identifier');
        return {
          kind: 'personal.message.created',
          eventId: updateKey(update),
          occurredAt,
          externalMessageId: messageId,
          author: toExternalUser(author),
          text: update.message.body?.text ?? null,
          attachmentMetadata: update.message.body?.attachments ?? [],
          forwardedMessage: forwarded
            ? {
                messageId: forwarded.message.mid,
                text: forwarded.message.text,
                attachmentMetadata: forwarded.message.attachments ?? [],
              }
            : null,
        };
      }
      if (chatId === null) throw new InvalidMaxUpdateError('Group message lacks chat');
      if (!update.message.body) throw new InvalidMaxUpdateError('Group message lacks a body');
      return {
        kind: 'message.created',
        eventId: updateKey(update),
        occurredAt,
        externalChatId: String(chatId),
        externalMessageId: update.message.body.mid,
        author: toExternalUser(author),
        text: update.message.body.text,
        attachmentMetadata: update.message.body.attachments ?? [],
      };
    }
    case 'message_callback':
      return {
        kind: 'message.callback',
        eventId: updateKey(update),
        occurredAt,
        externalChatId:
          update.message?.recipient.chat_type === 'dialog' ||
          update.message?.recipient.chat_id == null
            ? null
            : String(update.message.recipient.chat_id),
        externalMessageId: update.message?.body?.mid ?? null,
        actor: toExternalUser(update.callback.user),
        payload: update.callback.payload ?? null,
        callbackId: update.callback.callback_id,
      };
  }
}
