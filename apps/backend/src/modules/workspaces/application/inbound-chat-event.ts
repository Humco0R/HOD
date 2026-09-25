import type { ExternalUserProfile } from './chat-directory.port';

export type InboundChatEvent =
  | {
      kind: 'personal.started';
      eventId: string;
      occurredAt: Date;
      externalDialogId: string;
      actor: ExternalUserProfile;
    }
  | {
      kind: 'personal.message.created';
      eventId: string;
      occurredAt: Date;
      externalMessageId: string;
      author: ExternalUserProfile;
      text: string | null;
      attachmentMetadata: Record<string, unknown>[];
      forwardedMessage: {
        messageId: string;
        text: string | null;
        attachmentMetadata: Record<string, unknown>[];
      } | null;
    }
  | {
      kind: 'bot.added';
      eventId: string;
      occurredAt: Date;
      externalChatId: string;
      actor: ExternalUserProfile;
    }
  | {
      kind: 'bot.removed';
      eventId: string;
      occurredAt: Date;
      externalChatId: string;
    }
  | {
      kind: 'chat.title-changed';
      eventId: string;
      occurredAt: Date;
      externalChatId: string;
      title: string;
      actor: ExternalUserProfile;
    }
  | {
      kind: 'member.added';
      eventId: string;
      occurredAt: Date;
      externalChatId: string;
      member: ExternalUserProfile;
    }
  | {
      kind: 'member.removed';
      eventId: string;
      occurredAt: Date;
      externalChatId: string;
      memberExternalUserId: string;
    }
  | {
      kind: 'message.created';
      eventId: string;
      occurredAt: Date;
      externalChatId: string;
      externalMessageId: string;
      author: ExternalUserProfile;
      text: string | null;
      attachmentMetadata: Record<string, unknown>[];
    }
  | {
      kind: 'message.callback';
      eventId: string;
      occurredAt: Date;
      externalChatId: string | null;
      externalMessageId: string | null;
      actor: ExternalUserProfile;
      payload: string | null;
      callbackId: string;
    };

export interface InboundChatEventHandler {
  handle(event: InboundChatEvent): Promise<void>;
}
