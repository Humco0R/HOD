import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { ActionDetail, ActionSummary, CurrentUser } from '@hod/contracts';

import type { Database } from '../../../infrastructure/db/client';
import {
  actionEvents,
  actions,
  attachments,
  users,
  workspaceMembers,
  workspaces,
} from '../../../infrastructure/db/schema';
import type { ActionListView, ActionReadPort } from '../application/action-read.port';

export class DrizzleActionReadRepository implements ActionReadPort {
  constructor(private readonly database: Database) {}

  async getCurrentUser(userId: string, externalUserId: string): Promise<CurrentUser> {
    const rows = await this.database
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!rows[0]) throw new Error('Current user not found');
    return { ...rows[0], externalUserId };
  }

  async list(userId: string, view: ActionListView, now: Date): Promise<ActionSummary[]> {
    const memberships = await this.database
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
        settings: workspaces.settings,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, 'ACTIVE')));
    const allowed = memberships.filter((membership) =>
      view === 'team' ? membership.role === 'OWNER' : true,
    );
    if (!allowed.length) return [];
    const workspaceIds = allowed.map((membership) => membership.workspaceId);
    const rows = await this.database
      .select()
      .from(actions)
      .where(inArray(actions.workspaceId, workspaceIds))
      .orderBy(desc(actions.updatedAt));
    const filtered = rows.filter((action) => {
      if (action.status === 'CANCELLED') return false;
      if (view === 'assigned') return action.assigneeId === userId;
      if (view === 'created') return action.creatorId === userId;
      return true;
    });
    const timezones = new Map(
      allowed.map((membership) => [membership.workspaceId, membership.settings.timezone]),
    );
    return this.toSummaries(filtered, timezones, now);
  }

  async getDetail(userId: string, actionId: string, now: Date): Promise<ActionDetail | null> {
    const rows = await this.database
      .select({ action: actions, timezone: workspaces.settings })
      .from(actions)
      .innerJoin(workspaces, eq(workspaces.id, actions.workspaceId))
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, actions.workspaceId))
      .where(
        and(
          eq(actions.id, actionId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, 'ACTIVE'),
        ),
      );
    const permitted = rows[0];
    if (!permitted) return null;

    const summaries = await this.toSummaries(
      [permitted.action],
      new Map([[permitted.action.workspaceId, permitted.timezone.timezone]]),
      now,
    );
    const [events, storedAttachments] = await Promise.all([
      this.database
        .select({
          id: actionEvents.id,
          type: actionEvents.type,
          fromStatus: actionEvents.fromStatus,
          toStatus: actionEvents.toStatus,
          reason: actionEvents.reason,
          createdAt: actionEvents.createdAt,
        })
        .from(actionEvents)
        .where(eq(actionEvents.actionId, actionId))
        .orderBy(asc(actionEvents.createdAt)),
      this.database
        .select({
          id: attachments.id,
          originalName: attachments.originalName,
          mimeType: attachments.mimeType,
          sizeBytes: attachments.sizeBytes,
          createdAt: attachments.createdAt,
        })
        .from(attachments)
        .where(eq(attachments.actionId, actionId))
        .orderBy(asc(attachments.createdAt)),
    ]);
    return {
      ...summaries[0]!,
      description: permitted.action.description,
      sourceContext: permitted.action.sourceContextSnapshot,
      events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
      attachments: storedAttachments.map((attachment) => ({
        ...attachment,
        downloadUrl: `/api/attachments/${attachment.id}`,
        createdAt: attachment.createdAt.toISOString(),
      })),
    };
  }

  private async toSummaries(
    rows: Array<typeof actions.$inferSelect>,
    timezones: Map<string, string>,
    now: Date,
  ): Promise<ActionSummary[]> {
    const participantIds = [...new Set(rows.flatMap((row) => [row.creatorId, row.assigneeId]))];
    const participants = participantIds.length
      ? await this.database
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            username: users.username,
          })
          .from(users)
          .where(inArray(users.id, participantIds))
      : [];
    const byId = new Map(participants.map((participant) => [participant.id, participant]));
    return rows.map((action) => ({
      id: action.id,
      title: action.title,
      status: action.status,
      deadlineKind: action.deadlineKind,
      deadlineAt: action.deadlineAt?.toISOString() ?? null,
      deadlineDate: action.deadlineDate,
      deadlineDependency: action.deadlineDependency,
      deadlineRaw: action.deadlineRaw,
      location: action.location,
      expectedResultType: action.expectedResultType,
      expectedResultText: action.expectedResultText,
      creator: byId.get(action.creatorId)!,
      assignee: byId.get(action.assigneeId)!,
      attentionReasons: getAttentionReasons(
        action,
        now,
        timezones.get(action.workspaceId) ?? 'UTC',
      ),
      updatedAt: action.updatedAt.toISOString(),
    }));
  }
}

function getAttentionReasons(
  action: typeof actions.$inferSelect,
  now: Date,
  timezone: string,
): ActionSummary['attentionReasons'] {
  const reasons: ActionSummary['attentionReasons'] = [];
  const terminal =
    action.status === 'DONE' || action.status === 'VERIFIED' || action.status === 'CANCELLED';
  const localToday = formatDate(now, timezone);
  const deadlineDate = action.deadlineAt
    ? formatDate(action.deadlineAt, timezone)
    : action.deadlineDate;
  const overdue = action.deadlineAt
    ? action.deadlineAt < now
    : action.deadlineDate
      ? action.deadlineDate < localToday
      : false;
  if (!terminal && overdue) reasons.push('OVERDUE');
  if (action.status === 'BLOCKED') reasons.push('BLOCKED');
  if (action.status === 'DONE') reasons.push('AWAITING_VERIFICATION');
  if (!terminal && deadlineDate === localToday) reasons.push('DUE_TODAY');
  return reasons;
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
