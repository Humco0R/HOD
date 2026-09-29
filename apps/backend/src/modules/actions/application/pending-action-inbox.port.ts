export interface PendingActionInboxPort {
  refresh(assigneeExternalUserId: string, idempotencyKey: string): Promise<void>;
}

export interface PendingActionInboxViewPort extends PendingActionInboxPort {
  isCurrent(assigneeExternalUserId: string, revision: string): Promise<boolean>;
  showList(assigneeExternalUserId: string, page: number, idempotencyKey: string): Promise<void>;
  showDetail(
    assigneeExternalUserId: string,
    actionId: string,
    page: number,
    idempotencyKey: string,
  ): Promise<void>;
}

export interface PendingActionInboxSessionStore {
  isCurrent(externalUserId: string, revision: string): Promise<boolean>;
}
