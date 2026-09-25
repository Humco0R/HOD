export interface ActionReasonSession {
  id: string;
  actionId: string;
  command: 'BLOCK' | 'RETURN';
  reason: string | null;
  lastMessageId: string | null;
}

export interface ActionReasonSessionStore {
  get(externalUserId: string): Promise<ActionReasonSession | null>;
  set(externalUserId: string, session: ActionReasonSession): Promise<void>;
  clear(externalUserId: string): Promise<void>;
}
