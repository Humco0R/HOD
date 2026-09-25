export interface CreateActionInput {
  id: string;
  workspaceId: string;
  chatId: string;
  actorUserId: string;
  title: string;
  description: string | null;
  deadlineKind: 'UNKNOWN' | 'DATE_ONLY' | 'EXACT_DATETIME';
  deadlineDate: string | null;
  deadlineAt: Date | null;
  deadlineRaw: string | null;
}

export interface ActionCreatePort {
  create(input: CreateActionInput): Promise<{ actionId: string; created: boolean }>;
  exists(actionId: string, actorUserId: string): Promise<boolean>;
}
