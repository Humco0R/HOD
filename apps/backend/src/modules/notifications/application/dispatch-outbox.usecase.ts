import type { OutboxEventHandler, OutboxStore } from './outbox.port';

export class DispatchOutboxUseCase {
  constructor(
    private readonly store: OutboxStore,
    private readonly handler: OutboxEventHandler,
  ) {}

  async execute(now = new Date(), limit = 50): Promise<{ published: number; failed: number }> {
    const events = await this.store.claimBatch(now, limit);
    let published = 0;
    let failed = 0;
    for (const event of events) {
      try {
        await this.handler.handle(event);
        await this.store.markPublished(event.id, new Date());
        published += 1;
      } catch (error) {
        await this.store.markFailed(event, error, new Date());
        failed += 1;
      }
    }
    return { published, failed };
  }
}
