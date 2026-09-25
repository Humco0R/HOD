import type { RedisConnection } from '../../../infrastructure/redis/redis';
import type {
  PersonalActionResultSession,
  PersonalActionResultSessionStore,
} from '../application/personal-action-result-session.port';

export class RedisPersonalActionResultSessionStore implements PersonalActionResultSessionStore {
  constructor(private readonly redis: RedisConnection) {}

  async get(externalUserId: string): Promise<PersonalActionResultSession | null> {
    const value = await this.redis.get(key(externalUserId));
    return value ? (JSON.parse(value) as PersonalActionResultSession) : null;
  }

  async set(externalUserId: string, session: PersonalActionResultSession): Promise<void> {
    await this.redis.set(key(externalUserId), JSON.stringify(session));
  }

  async clear(externalUserId: string): Promise<void> {
    await this.redis.del(key(externalUserId));
  }
}

function key(externalUserId: string): string {
  return `hod:personal:action-result:${externalUserId}`;
}
