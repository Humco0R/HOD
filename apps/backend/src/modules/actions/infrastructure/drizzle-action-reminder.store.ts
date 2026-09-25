import { eq, notInArray } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { actions, workspaces } from '../../../infrastructure/db/schema';
import { enqueueOutboxEvent } from '../../notifications';
import type { ActionReminderScheduleStore } from '../application/schedule-action-reminders.usecase';

export class DrizzleActionReminderStore implements ActionReminderScheduleStore {
  constructor(private readonly database: Database) {}

  schedule(now: Date, leadMinutes: number): Promise<number> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select({ action: actions, settings: workspaces.settings })
        .from(actions)
        .innerJoin(workspaces, eq(workspaces.id, actions.workspaceId))
        .where(notInArray(actions.status, ['DONE', 'VERIFIED', 'CANCELLED']));
      const due = rows.filter(({ action, settings }) =>
        isDue(action, settings.timezone, now, leadMinutes),
      );
      for (const { action } of due) {
        const deadlineKey = action.deadlineAt?.toISOString() ?? action.deadlineDate!;
        const dedupeKey = `reminder-${action.id}-${deadlineKey}`;
        await enqueueOutboxEvent(transaction, {
          topic: 'ACTION_REMINDER_REQUESTED',
          dedupeKey,
          payload: { actionId: action.id, idempotencyKey: dedupeKey },
        });
      }
      return due.length;
    });
  }
}

function isDue(
  action: typeof actions.$inferSelect,
  timezone: string,
  now: Date,
  leadMinutes: number,
): boolean {
  if (action.deadlineAt) {
    const until = action.deadlineAt.valueOf() - now.valueOf();
    return until > 0 && until <= leadMinutes * 60_000;
  }
  return Boolean(action.deadlineDate && action.deadlineDate === formatDate(now, timezone));
}

function formatDate(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}
