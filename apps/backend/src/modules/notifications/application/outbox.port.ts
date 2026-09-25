export interface OutboxEventInput {
  topic: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
}

export interface ClaimedOutboxEvent extends OutboxEventInput {
  id: string;
  attempts: number;
}

export interface OutboxStore {
  claimBatch(now: Date, limit: number): Promise<ClaimedOutboxEvent[]>;
  markPublished(id: string, now: Date): Promise<void>;
  markFailed(event: ClaimedOutboxEvent, error: unknown, now: Date): Promise<void>;
  cleanupPublished(before: Date): Promise<number>;
}

export interface OutboxEventHandler {
  handle(event: ClaimedOutboxEvent): Promise<void>;
}
