import { createHash, randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { Database } from '../../../infrastructure/db/client';
import type { RedisConnection } from '../../../infrastructure/redis/redis';
import { users, workspaceMembers } from '../../../infrastructure/db/schema';
import type { ValidatedMaxIdentity } from '../domain/max-init-data';

export interface MiniAppSession {
  userId: string;
  externalUserId: string;
}

export class MiniAppSessionService {
  constructor(
    private readonly database: Database,
    private readonly redis: RedisConnection,
    private readonly ttlSeconds: number,
  ) {}

  async create(
    identity: ValidatedMaxIdentity,
  ): Promise<{ token: string; session: MiniAppSession }> {
    const rows = await this.database
      .select({ userId: users.id })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(
        and(
          eq(users.maxUserId, BigInt(identity.externalUserId)),
          eq(workspaceMembers.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new Error('MAX user is not an active ХОД workspace member');
    const token = randomBytes(32).toString('base64url');
    const session = { userId: rows[0].userId, externalUserId: identity.externalUserId };
    await this.redis.set(sessionKey(token), JSON.stringify(session), 'EX', this.ttlSeconds);
    return { token, session };
  }

  async findActiveExternalUserId(preferredExternalUserId?: string): Promise<string | null> {
    const condition = preferredExternalUserId
      ? and(
          eq(users.maxUserId, BigInt(preferredExternalUserId)),
          eq(workspaceMembers.status, 'ACTIVE'),
        )
      : eq(workspaceMembers.status, 'ACTIVE');
    const rows = await this.database
      .select({ externalUserId: users.maxUserId })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(condition)
      .limit(1);
    return rows[0]?.externalUserId.toString() ?? null;
  }

  async get(token: string | undefined): Promise<MiniAppSession | null> {
    if (!token || token.length > 128) return null;
    const raw = await this.redis.get(sessionKey(token));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<MiniAppSession>;
    if (typeof value.userId !== 'string' || typeof value.externalUserId !== 'string') return null;
    const memberships = await this.database
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, value.userId), eq(workspaceMembers.status, 'ACTIVE')))
      .limit(1);
    if (!memberships[0]) {
      await this.redis.del(sessionKey(token));
      return null;
    }
    return { userId: value.userId, externalUserId: value.externalUserId };
  }

  async delete(token: string | undefined): Promise<void> {
    if (token) await this.redis.del(sessionKey(token));
  }
}

function sessionKey(token: string): string {
  return `miniapp:session:${createHash('sha256').update(token).digest('hex')}`;
}
