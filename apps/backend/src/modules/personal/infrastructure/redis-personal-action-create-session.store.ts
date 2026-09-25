import type { RedisConnection } from '../../../infrastructure/redis/redis';
import type {
  PersonalActionCreateSession,
  PersonalActionCreateSessionStore,
} from '../application/personal-action-create-session.port';

const SESSION_TTL_SECONDS = 60 * 60;

export class RedisPersonalActionCreateSessionStore implements PersonalActionCreateSessionStore {
  constructor(private readonly redis: RedisConnection) {}

  async get(externalUserId: string): Promise<PersonalActionCreateSession | null> {
    const value = await this.redis.get(key(externalUserId));
    return value ? (JSON.parse(value) as PersonalActionCreateSession) : null;
  }

  async set(externalUserId: string, session: PersonalActionCreateSession): Promise<void> {
    await this.redis.set(key(externalUserId), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  }

  async clear(externalUserId: string): Promise<void> {
    await this.redis.del(key(externalUserId));
  }
}

function key(externalUserId: string): string {
  return `hod:personal:action-create:${externalUserId}`;
}
