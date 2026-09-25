import { z } from 'zod';

import type { RedisConnection } from '../../../infrastructure/redis/redis';
import type { ConversationContextPort } from '../application/detection.ports';
import type { DetectionContextMessage } from '../domain/detection';

const messageSchema = z.object({
  messageId: z.string(),
  senderMaxUserId: z.string(),
  timestamp: z.iso.datetime(),
  text: z.string().nullable(),
});

export class RedisConversationContext implements ConversationContextPort {
  constructor(
    private readonly redis: RedisConnection,
    private readonly ttlSeconds = 24 * 60 * 60,
    private readonly windowSize = 5,
  ) {}

  async append(
    externalChatId: string,
    message: DetectionContextMessage,
  ): Promise<DetectionContextMessage[]> {
    const key = `context:max-chat:${externalChatId}`;
    await this.redis
      .multi()
      .rpush(key, JSON.stringify(message))
      .ltrim(key, -this.windowSize, -1)
      .expire(key, this.ttlSeconds)
      .exec();
    const values = await this.redis.lrange(key, 0, -1);
    return values.map((value) => messageSchema.parse(JSON.parse(value)));
  }
}
