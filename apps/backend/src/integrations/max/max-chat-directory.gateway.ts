import type { Api } from '@maxhub/max-bot-api';
import type { ChatMember } from '@maxhub/max-bot-api/types';

import type {
  ChatDirectoryGateway,
  ExternalChatSnapshot,
  ExternalUserProfile,
} from '../../modules/workspaces';

export class MaxChatDirectoryGateway implements ChatDirectoryGateway {
  constructor(private readonly api: Api) {}

  async getChatSnapshot(externalChatId: string): Promise<ExternalChatSnapshot> {
    const chatId = toSdkId(externalChatId);
    const [chat, botMembership, members] = await Promise.all([
      this.api.getChat(chatId),
      this.api.getChatMembership(chatId),
      this.getAllMembers(chatId),
    ]);

    return {
      externalChatId,
      title: chat.title,
      status: mapChatStatus(chat.status),
      botHasReadAccess: botMembership.permissions?.includes('read_all_messages') ?? false,
      ownerExternalUserId:
        chat.owner_id === null || chat.owner_id === undefined ? null : String(chat.owner_id),
      members: members.filter((member) => !member.is_bot).map(toExternalUser),
    };
  }

  private async getAllMembers(chatId: number): Promise<ChatMember[]> {
    const members: ChatMember[] = [];
    let marker: number | null | undefined;
    do {
      const page = await this.api.getChatMembers(chatId, {
        count: 100,
        ...(marker === null || marker === undefined ? {} : { marker }),
      });
      members.push(...page.members);
      marker = page.marker;
    } while (marker !== null && marker !== undefined);
    return members;
  }
}

function toSdkId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id))
    throw new Error('MAX identifier is outside the SDK safe integer range');
  return id;
}

function mapChatStatus(status: 'active' | 'removed' | 'left' | 'closed') {
  return status.toUpperCase() as ExternalChatSnapshot['status'];
}

export function toExternalUser(user: {
  user_id: number;
  first_name: string;
  last_name?: string | undefined;
  username?: string | null | undefined;
}): ExternalUserProfile {
  return {
    externalUserId: String(user.user_id),
    firstName: user.first_name,
    lastName: user.last_name ?? null,
    username: user.username ?? null,
  };
}
