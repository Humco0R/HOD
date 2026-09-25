import { z } from 'zod';

import type {
  ActionContextStore,
  ActionLifecycleNotificationPort,
  ActionReminderNotificationPort,
} from '../../modules/actions';
import type { AssignmentNotificationPort, DetectionProposalPort } from '../../modules/detections';
import type { OutboxEventHandler, ClaimedOutboxEvent } from '../../modules/notifications';

const candidateSchema = z.object({
  classification: z.enum(['ACTIONABLE', 'NOT_ACTIONABLE', 'UNCERTAIN']),
  title: z.string().nullable(),
  assigneeReference: z.string().nullable(),
  deadlineKind: z.enum(['EXACT_DATETIME', 'DATE_ONLY', 'RELATIVE', 'DEPENDENCY', 'UNKNOWN']),
  deadlineAt: z.string().nullable(),
  deadlineDate: z.string().nullable(),
  deadlineDependency: z.string().nullable(),
  deadlineRaw: z.string().nullable(),
  expectedResultType: z.enum(['PHOTO', 'FILE', 'TEXT', 'NONE', 'UNKNOWN']),
  expectedResultText: z.string().nullable(),
  location: z.string().nullable(),
  confidence: z.number(),
  raw: z.record(z.string(), z.unknown()),
});
const proposalBaseSchema = z.object({
  detectionId: z.uuid(),
  candidate: candidateSchema,
  assignee: z.object({
    status: z.enum(['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED']),
    userId: z.uuid().nullable(),
  }),
});
const proposalSchema = z.union([
  proposalBaseSchema.extend({
    target: z.object({ type: z.enum(['CHAT', 'USER']), externalId: z.string() }),
    assigneeLabel: z.string().nullable().default(null),
  }),
  proposalBaseSchema
    .extend({ externalChatId: z.string() })
    .transform(({ externalChatId, ...payload }) => ({
      ...payload,
      target: { type: 'CHAT' as const, externalId: externalChatId },
      assigneeLabel: null,
    })),
]);
const assignmentSchema = z.object({
  actionId: z.uuid(),
  assigneeExternalUserId: z.string(),
  creatorName: z.string().optional(),
  title: z.string(),
});
const transitionSchema = z.object({
  actionId: z.uuid(),
  command: z.enum([
    'ACCEPT',
    'START',
    'BLOCK',
    'UNBLOCK',
    'SUBMIT_RESULT',
    'VERIFY',
    'RETURN',
    'CANCEL',
  ]),
  reason: z.string().nullable(),
  idempotencyKey: z.string(),
});
const reminderSchema = z.object({ actionId: z.uuid(), idempotencyKey: z.string() });

export class ApplicationOutboxHandler implements OutboxEventHandler {
  constructor(
    private readonly detectionNotifications: DetectionProposalPort & AssignmentNotificationPort,
    private readonly actionContexts: ActionContextStore,
    private readonly actionNotifications: ActionLifecycleNotificationPort,
    private readonly reminderNotifications: ActionReminderNotificationPort,
  ) {}

  async handle(event: ClaimedOutboxEvent): Promise<void> {
    switch (event.topic) {
      case 'DETECTION_PROPOSAL_REQUESTED':
        await this.detectionNotifications.publish(proposalSchema.parse(event.payload));
        return;
      case 'ASSIGNMENT_NOTIFICATION_REQUESTED': {
        const assignment = assignmentSchema.parse(event.payload);
        await this.detectionNotifications.publish({
          actionId: assignment.actionId,
          assigneeExternalUserId: assignment.assigneeExternalUserId,
          title: assignment.title,
          ...(assignment.creatorName ? { creatorName: assignment.creatorName } : {}),
        });
        return;
      }
      case 'ACTION_TRANSITION_NOTIFICATION_REQUESTED': {
        const payload = transitionSchema.parse(event.payload);
        await this.actionNotifications.publish({
          context: await this.actionContexts.getNotificationContext(payload.actionId),
          command: payload.command,
          reason: payload.reason,
          idempotencyKey: payload.idempotencyKey,
        });
        return;
      }
      case 'ACTION_REMINDER_REQUESTED': {
        const payload = reminderSchema.parse(event.payload);
        await this.reminderNotifications.publish({
          context: await this.actionContexts.getNotificationContext(payload.actionId),
          idempotencyKey: payload.idempotencyKey,
        });
        return;
      }
      default:
        throw new Error(`Unsupported outbox topic: ${event.topic}`);
    }
  }
}
