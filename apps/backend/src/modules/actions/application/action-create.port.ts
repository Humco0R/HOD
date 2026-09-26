export interface CreateActionInput {
  id: string;
  workspaceId: string;
  chatId: string;
  actorUserId: string;
  assigneeUserId: string;
  title: string;
  description: string | null;
  deadlineKind: 'UNKNOWN' | 'DATE_ONLY' | 'EXACT_DATETIME';
  deadlineDate: string | null;
  deadlineAt: Date | null;
  deadlineRaw: string | null;
  source: 'PERSONAL_BOT' | 'MINIAPP';
}

export interface ActionCreatePort {
  create(input: CreateActionInput): Promise<{ actionId: string; created: boolean }>;
  exists(actionId: string, actorUserId: string): Promise<boolean>;
}
