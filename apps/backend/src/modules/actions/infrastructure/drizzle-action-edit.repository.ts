import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { actions } from '../../../infrastructure/db/schema';

import type {
  ActionEditPort,
  UpdateActionTitleInput,
  UpdateActionDescriptionInput,
  UpdateActionLocationInput,
  UpdateActionDeadlineInput,
} from '../application/action-edit.port';

export class DrizzleActionEditRepository implements ActionEditPort {
  constructor(private readonly database: Database) {}

  async updateTitle(input: UpdateActionTitleInput): Promise<boolean> {
    const rows = await this.database
      .update(actions)
      .set({
        title: input.title,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actions.id, input.actionId),
          eq(actions.creatorId, input.actorUserId),
          eq(actions.assigneeId, input.actorUserId),
          inArray(actions.status, ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED']),
        ),
      )
      .returning({
        id: actions.id,
      });

    return rows.length > 0;
  }

  async updateDescription(input: UpdateActionDescriptionInput): Promise<boolean> {
    const rows = await this.database
      .update(actions)
      .set({
        description: input.description,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actions.id, input.actionId),
          eq(actions.creatorId, input.actorUserId),
          eq(actions.assigneeId, input.actorUserId),
          inArray(actions.status, ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED']),
        ),
      )
      .returning({
        id: actions.id,
      });

    return rows.length > 0;
  }

  async updateLocation(input: UpdateActionLocationInput): Promise<boolean> {
    const rows = await this.database
      .update(actions)
      .set({
        location: input.location,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actions.id, input.actionId),
          eq(actions.creatorId, input.actorUserId),
          eq(actions.assigneeId, input.actorUserId),
          inArray(actions.status, ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED']),
        ),
      )
      .returning({
        id: actions.id,
      });

    return rows.length > 0;
  }

  async updateDeadline(input: UpdateActionDeadlineInput): Promise<boolean> {
    const rows = await this.database
      .update(actions)
      .set({
        deadlineKind: input.deadlineKind,
        deadlineAt: input.deadlineAt,
        deadlineDate: input.deadlineDate,
        deadlineDependency: input.deadlineDependency,
        deadlineRaw: input.deadlineRaw,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actions.id, input.actionId),
          eq(actions.creatorId, input.actorUserId),
          eq(actions.assigneeId, input.actorUserId),
          inArray(actions.status, ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED']),
        ),
      )
      .returning({
        id: actions.id,
      });

    return rows.length > 0;
  }
}
