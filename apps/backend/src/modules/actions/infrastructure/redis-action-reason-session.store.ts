import type { RedisConnection } from '../../../infrastructure/redis/redis';
import type {
  ActionReasonSession,
  ActionReasonSessionStore,
} from '../application/action-reason-session.port';

export class RedisActionReasonSessionStore implements ActionReasonSessionStore {
  constructor(private readonly redis: RedisConnection) {}

  async get(externalUserId: string): Promise<ActionReasonSession | null> {
    const value = await this.redis.get(`hod:action-reason:${externalUserId}`);
    return value ? (JSON.parse(value) as ActionReasonSession) : null;
  }

  async set(externalUserId: string, session: ActionReasonSession): Promise<void> {
    await this.redis.set(
      `hod:action-reason:${externalUserId}`,
      JSON.stringify(session),
      'EX',
      3600,
    );
  }

  async clear(externalUserId: string): Promise<void> {
    await this.redis.del(`hod:action-reason:${externalUserId}`);
  }
}
