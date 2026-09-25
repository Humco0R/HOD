import { and, eq, inArray, lt, lte, or } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { outboxEvents } from '../../../infrastructure/db/schema';
import type { ClaimedOutboxEvent, OutboxEventInput, OutboxStore } from '../application/outbox.port';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function enqueueOutboxEvent(
  transaction: Transaction,
  event: OutboxEventInput,
): Promise<void> {
  return transaction
    .insert(outboxEvents)
    .values(event)
    .onConflictDoNothing({ target: outboxEvents.dedupeKey })
    .then(() => undefined);
}

export class DrizzleOutboxStore implements OutboxStore {
  constructor(
    private readonly database: Database,
    private readonly maximumAttempts = 10,
    private readonly staleLockMilliseconds = 5 * 60_000,
  ) {}

  claimBatch(now: Date, limit: number): Promise<ClaimedOutboxEvent[]> {
    return this.database.transaction(async (transaction) => {
      const staleBefore = new Date(now.valueOf() - this.staleLockMilliseconds);
      const rows = await transaction
        .select()
        .from(outboxEvents)
        .where(
          or(
            and(eq(outboxEvents.status, 'PENDING'), lte(outboxEvents.availableAt, now)),
            and(eq(outboxEvents.status, 'PROCESSING'), lt(outboxEvents.lockedAt, staleBefore)),
          ),
        )
        .limit(limit)
        .for('update', { skipLocked: true });
      if (!rows.length) return [];
      await transaction
        .update(outboxEvents)
        .set({ status: 'PROCESSING', lockedAt: now })
        .where(
          inArray(
            outboxEvents.id,
            rows.map(({ id }) => id),
          ),
        );
      return rows.map(({ id, topic, dedupeKey, payload, attempts }) => ({
        id,
        topic,
        dedupeKey,
        payload,
        attempts,
      }));
    });
  }

  async markPublished(id: string, now: Date): Promise<void> {
    await this.database
      .update(outboxEvents)
      .set({ status: 'PUBLISHED', publishedAt: now, lockedAt: null, lastError: null })
      .where(eq(outboxEvents.id, id));
  }

  async markFailed(event: ClaimedOutboxEvent, error: unknown, now: Date): Promise<void> {
    const attempts = event.attempts + 1;
    const terminal = attempts >= this.maximumAttempts;
    const delay = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempts - 1, 8));
    await this.database
      .update(outboxEvents)
      .set({
        status: terminal ? 'FAILED' : 'PENDING',
        attempts,
        availableAt: new Date(now.valueOf() + delay),
        lockedAt: null,
        lastError: safeError(error),
      })
      .where(eq(outboxEvents.id, event.id));
  }

  async cleanupPublished(before: Date): Promise<number> {
    const deleted = await this.database
      .delete(outboxEvents)
      .where(and(eq(outboxEvents.status, 'PUBLISHED'), lt(outboxEvents.publishedAt, before)))
      .returning({ id: outboxEvents.id });
    return deleted.length;
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown outbox dispatch error';
  return message.slice(0, 1_000);
}
