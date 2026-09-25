import type {
  ChatDirectoryGateway,
  ChatDirectoryStore,
  ExternalUserProfile,
} from './chat-directory.port';
import type { InboundChatEvent, InboundChatEventHandler } from './inbound-chat-event';

export class SynchronizeChatDirectoryUseCase implements InboundChatEventHandler {
  constructor(
    private readonly store: ChatDirectoryStore,
    private readonly gateway: ChatDirectoryGateway,
    private readonly defaultTimezone: string,
    private readonly downstream?: InboundChatEventHandler,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (
      event.kind === 'personal.started' ||
      event.kind === 'personal.message.created' ||
      (event.kind === 'message.callback' && event.externalChatId === null)
    ) {
      await this.downstream?.handle(event);
      return;
    }

    const externalChatId = event.externalChatId;
    if (externalChatId === null) throw new Error('Chat event lacks an external chat identifier');
    await this.ensureChat(externalChatId, event.kind === 'bot.added' ? event.actor : undefined);

    switch (event.kind) {
      case 'bot.added':
        await this.store.activateMember(externalChatId, event.actor);
        break;
      case 'bot.removed':
        await this.store.updateChat({ externalChatId, status: 'REMOVED' });
        break;
      case 'chat.title-changed':
        await Promise.all([
          this.store.updateChat({ externalChatId, title: event.title }),
          this.store.activateMember(externalChatId, event.actor),
        ]);
        break;
      case 'member.added':
        await this.store.activateMember(externalChatId, event.member);
        break;
      case 'member.removed':
        await this.store.removeMember(externalChatId, event.memberExternalUserId);
        break;
      case 'message.created':
        await this.store.activateMember(externalChatId, event.author);
        break;
      case 'message.callback':
        await this.store.activateMember(externalChatId, event.actor);
        break;
    }

    await this.downstream?.handle(event);
  }

  private async ensureChat(
    externalChatId: string,
    bootstrapOwner?: ExternalUserProfile,
  ): Promise<void> {
    if (await this.store.findByExternalChatId(externalChatId)) return;

    const snapshot = await this.gateway.getChatSnapshot(externalChatId);
    const owner =
      bootstrapOwner ?? this.resolveSnapshotOwner(snapshot.ownerExternalUserId, snapshot.members);
    await this.store.bootstrapChat({ snapshot, owner, timezone: this.defaultTimezone });
  }

  private resolveSnapshotOwner(
    ownerExternalUserId: string | null,
    members: ExternalUserProfile[],
  ): ExternalUserProfile {
    const owner = members.find((member) => member.externalUserId === ownerExternalUserId);
    if (!owner) {
      throw new Error('Cannot bootstrap workspace without a resolvable chat owner');
    }
    return owner;
  }
}
