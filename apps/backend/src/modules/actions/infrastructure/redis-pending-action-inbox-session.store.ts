import type { RedisConnection } from '../../../infrastructure/redis/redis';
import type { PendingActionInboxSessionStore } from '../application/pending-action-inbox.port';

export class RedisPendingActionInboxSessionStore implements PendingActionInboxSessionStore {
  constructor(private readonly redis: RedisConnection) {}

  async isCurrent(externalUserId: string, revision: string): Promise<boolean> {
    return (await this.redis.get(key(externalUserId))) === revision;
  }
}

function key(externalUserId: string): string {
  return `hod:max:screen-revision:${externalUserId}:pending-actions`;
}
