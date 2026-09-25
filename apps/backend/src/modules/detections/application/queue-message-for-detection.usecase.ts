import type {
  ChatDirectoryStore,
  InboundChatEvent,
  InboundChatEventHandler,
} from '../../workspaces';
import type { DetectionContextMessage, DetectionJob } from '../domain/detection';
import type { ConversationContextPort, DetectionQueuePort } from './detection.ports';

export class QueueMessageForDetectionUseCase implements InboundChatEventHandler {
  constructor(
    private readonly directory: ChatDirectoryStore,
    private readonly context: ConversationContextPort,
    private readonly queue: DetectionQueuePort,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind !== 'message.created') return;
    const participant = await this.directory.findParticipant(
      event.externalChatId,
      event.author.externalUserId,
    );
    if (!participant) throw new Error('Message author is not an active workspace member');

    const message: DetectionContextMessage = {
      messageId: event.externalMessageId,
      senderMaxUserId: event.author.externalUserId,
      timestamp: event.occurredAt.toISOString(),
      text: event.text,
    };
    const context = await this.context.append(event.externalChatId, message);
    const job: DetectionJob = {
      sourceMode: 'GROUP_CHAT',
      assignmentStrategy: 'RESOLVE_FROM_TEXT',
      proposalTarget: { type: 'CHAT', externalId: event.externalChatId },
      workspaceId: participant.workspaceId,
      chatId: participant.chatId,
      externalChatId: event.externalChatId,
      sourceMessageId: event.externalMessageId,
      sourceSenderId: participant.userId,
      sourceSenderExternalId: event.author.externalUserId,
      occurredAt: event.occurredAt.toISOString(),
      text: event.text,
      attachmentMetadata: event.attachmentMetadata,
      context,
    };
    await this.queue.publish(job, event.eventId);
  }
}
