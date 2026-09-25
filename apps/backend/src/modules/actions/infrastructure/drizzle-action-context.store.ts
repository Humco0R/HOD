import { and, count, eq } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { actions, attachments, users, workspaceMembers } from '../../../infrastructure/db/schema';
import type {
  ActionActorContext,
  ActionContextStore,
  ActionNotificationContext,
} from '../application/action-context.port';

export class DrizzleActionContextStore implements ActionContextStore {
  constructor(private readonly database: Database) {}

  async resolveActor(
    actionId: string,
    actorExternalUserId: string,
  ): Promise<ActionActorContext | null> {
    const actionRows = await this.database
      .select({ workspaceId: actions.workspaceId })
      .from(actions)
      .where(eq(actions.id, actionId))
      .limit(1);
    if (!actionRows[0]) return null;
    const actorRows = await this.database
      .select({ actorId: users.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, actionRows[0].workspaceId),
          eq(workspaceMembers.status, 'ACTIVE'),
          eq(users.maxUserId, BigInt(actorExternalUserId)),
        ),
      )
      .limit(1);
    return actorRows[0]
      ? { workspaceId: actionRows[0].workspaceId, actorId: actorRows[0].actorId }
      : null;
  }

  async getNotificationContext(actionId: string): Promise<ActionNotificationContext> {
    const actionRows = await this.database
      .select({
        actionId: actions.id,
        title: actions.title,
        status: actions.status,
        creatorId: actions.creatorId,
        assigneeId: actions.assigneeId,
      })
      .from(actions)
      .where(eq(actions.id, actionId))
      .limit(1);
    const action = actionRows[0];
    if (!action) throw new Error('Action notification context not found');
    const participantRows = await this.database
      .select({ id: users.id, externalId: users.maxUserId })
      .from(users)
      .where(eq(users.id, action.creatorId));
    const assigneeRows = await this.database
      .select({ externalId: users.maxUserId })
      .from(users)
      .where(eq(users.id, action.assigneeId))
      .limit(1);
    const attachmentRows = await this.database
      .select({ value: count() })
      .from(attachments)
      .where(eq(attachments.actionId, actionId));
    if (!participantRows[0] || !assigneeRows[0]) throw new Error('Action participant not found');
    return {
      actionId: action.actionId,
      title: action.title,
      status: action.status,
      creatorExternalUserId: participantRows[0].externalId.toString(),
      assigneeExternalUserId: assigneeRows[0].externalId.toString(),
      attachmentCount: attachmentRows[0]?.value ?? 0,
    };
  }
}
