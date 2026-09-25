import { and, eq } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import { users, workspaceMembers, workspaces } from '../../../infrastructure/db/schema';
import type { DetectionWorkspaceContextPort } from '../application/detection.ports';
import type { DetectionWorkspaceContext } from '../domain/detection';

export class DrizzleDetectionWorkspaceContext implements DetectionWorkspaceContextPort {
  constructor(private readonly database: Database) {}

  async get(workspaceId: string): Promise<DetectionWorkspaceContext> {
    const rows = await this.database
      .select({
        settings: workspaces.settings,
        externalUserId: users.maxUserId,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaces.id, workspaceId), eq(workspaceMembers.status, 'ACTIVE')));
    if (!rows[0]) throw new Error('Detection workspace has no active members');
    return {
      timezone: rows[0].settings.timezone,
      members: rows.map((row) => ({
        externalUserId: row.externalUserId.toString(),
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
      })),
    };
  }
}
