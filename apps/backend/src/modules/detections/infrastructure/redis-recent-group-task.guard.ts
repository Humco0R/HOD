import { createHash } from 'node:crypto';

import type { RedisConnection } from '../../../infrastructure/redis/redis';
import type { RecentGroupTaskGuardPort } from '../application/detection.ports';
import type { DetectionJob } from '../domain/detection';

const duplicateWindowSeconds = 5 * 60;

export class RedisRecentGroupTaskGuard implements RecentGroupTaskGuardPort {
  constructor(private readonly redis: RedisConnection) {}

  async claim(job: DetectionJob): Promise<boolean> {
    const key = duplicateKey(job);
    if (!key) return true;
    const claimed = await this.redis.set(
      key,
      job.sourceMessageId,
      'EX',
      duplicateWindowSeconds,
      'NX',
    );
    if (claimed === 'OK') return true;
    return (await this.redis.get(key)) === job.sourceMessageId;
  }

  async release(job: DetectionJob): Promise<void> {
    const key = duplicateKey(job);
    if (!key) return;
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      job.sourceMessageId,
    );
  }
}

function duplicateKey(job: DetectionJob): string | null {
  if (job.sourceMode !== 'GROUP_CHAT' || job.attachmentMetadata.length > 0) return null;
  const text = job.text?.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU');
  if (!text) return null;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([job.chatId, job.sourceSenderId, text]))
    .digest('hex');
  return `hod:detection:recent-group-task:${fingerprint}`;
}
