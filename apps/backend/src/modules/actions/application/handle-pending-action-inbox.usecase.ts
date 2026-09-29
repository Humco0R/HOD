import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';
import type { PendingActionInboxViewPort } from './pending-action-inbox.port';

const listPattern = /^hod:personal:pending:list:(\d{1,4}):([a-f0-9]{16})$/i;
const detailPattern = /^hod:personal:pending:detail:([0-9a-f-]{36}):(\d{1,4}):([a-f0-9]{16})$/i;

export class HandlePendingActionInboxUseCase implements InboundChatEventHandler {
  constructor(private readonly inbox: PendingActionInboxViewPort) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind !== 'message.callback' || !event.payload) return;

    const list = listPattern.exec(event.payload);
    const detail = detailPattern.exec(event.payload);
    const revision = list?.[2] ?? detail?.[3];
    if (!revision) return;

    const externalUserId = event.actor.externalUserId;
    if (!(await this.inbox.isCurrent(externalUserId, revision))) return;

    if (list) {
      await this.inbox.showList(
        externalUserId,
        Number(list[1]),
        `pending-list-${event.callbackId}`,
      );
      return;
    }

    await this.inbox.showDetail(
      externalUserId,
      detail![1]!,
      Number(detail![2]),
      `pending-detail-${event.callbackId}`,
    );
  }
}
