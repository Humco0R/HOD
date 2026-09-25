import type { ExternalUserProfile } from '../../workspaces';

export interface PersonalWorkspaceContext {
  workspaceId: string;
  chatId: string;
  userId: string;
  timezone: string;
}

export interface PersonalWorkspaceStore {
  findByExternalUserId(externalUserId: string): Promise<PersonalWorkspaceContext | null>;
  bootstrap(input: {
    externalDialogId: string | null;
    user: ExternalUserProfile;
    timezone: string;
  }): Promise<PersonalWorkspaceContext>;
}
