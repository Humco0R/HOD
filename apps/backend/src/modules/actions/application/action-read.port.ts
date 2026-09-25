import type { ActionDetail, ActionSummary, CurrentUser } from '@hod/contracts';

export type ActionListView = 'assigned' | 'created' | 'team';

export interface ActionReadPort {
  getCurrentUser(userId: string, externalUserId: string): Promise<CurrentUser>;
  list(userId: string, view: ActionListView, now: Date): Promise<ActionSummary[]>;
  getDetail(userId: string, actionId: string, now: Date): Promise<ActionDetail | null>;
}
