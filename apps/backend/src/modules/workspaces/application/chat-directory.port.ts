export interface ExternalUserProfile {
  externalUserId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

export interface ExternalChatSnapshot {
  externalChatId: string;
  title: string | null;
  status: 'ACTIVE' | 'REMOVED' | 'LEFT' | 'CLOSED';
  botHasReadAccess: boolean;
  ownerExternalUserId: string | null;
  members: ExternalUserProfile[];
}

export interface ChatDirectoryContext {
  workspaceId: string;
  chatId: string;
}

export interface ChatParticipantContext extends ChatDirectoryContext {
  userId: string;
}

export interface ChatDirectoryGateway {
  getChatSnapshot(externalChatId: string): Promise<ExternalChatSnapshot>;
}

export interface ChatDirectoryStore {
  findByExternalChatId(externalChatId: string): Promise<ChatDirectoryContext | null>;
  findParticipant(
    externalChatId: string,
    externalUserId: string,
  ): Promise<ChatParticipantContext | null>;
  bootstrapChat(input: {
    snapshot: ExternalChatSnapshot;
    owner: ExternalUserProfile;
    timezone: string;
  }): Promise<ChatDirectoryContext>;
  activateMember(externalChatId: string, user: ExternalUserProfile): Promise<void>;
  removeMember(externalChatId: string, externalUserId: string): Promise<void>;
  updateChat(input: {
    externalChatId: string;
    title?: string;
    status?: ExternalChatSnapshot['status'];
  }): Promise<void>;
}
