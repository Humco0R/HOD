import type { RedisConnection } from '../../../infrastructure/redis/redis';

import type {
  PersonalActionEditSession,
  PersonalActionEditSessionStore,
} from '../application/personal-action-edit-session.port';

const SESSION_TTL_SECONDS = 15 * 60;

export class RedisPersonalActionEditSessionStore implements PersonalActionEditSessionStore {
  constructor(private readonly redis: RedisConnection) {}

  async get(externalUserId: string): Promise<PersonalActionEditSession | null> {
    const value = await this.redis.get(key(externalUserId));

    if (!value) {
      return null;
    }

    return JSON.parse(value) as PersonalActionEditSession;
  }

  async set(externalUserId: string, session: PersonalActionEditSession): Promise<void> {
    await this.redis.set(key(externalUserId), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  }

  async clear(externalUserId: string): Promise<void> {
    await this.redis.del(key(externalUserId));
  }
}

function key(externalUserId: string): string {
  return `hod:personal:action-edit:${externalUserId}`;
}
