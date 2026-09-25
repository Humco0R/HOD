import { createHash } from 'node:crypto';

import type { JobsOptions } from 'bullmq';

import type { NotificationPublisher } from '../../notifications';
import type {
  AssignmentNotificationPort,
  DetectionProposalPort,
  DetectionQueuePort,
} from '../application/detection.ports';
import type { DetectionJob } from '../domain/detection';

interface JobQueue<T> {
  add(name: string, data: T, options?: JobsOptions): Promise<unknown>;
}

export class BullMqDetectionQueue implements DetectionQueuePort {
  constructor(private readonly queue: JobQueue<DetectionJob>) {}

  async publish(job: DetectionJob, idempotencyKey: string): Promise<void> {
    await this.queue.add('detect-message', job, {
      jobId: createHash('sha256').update(idempotencyKey).digest('hex'),
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
    });
  }
}

export class BullMqDetectionMessaging implements DetectionProposalPort, AssignmentNotificationPort {
  constructor(private readonly notifications: NotificationPublisher) {}

  async publish(
    input:
      | Parameters<DetectionProposalPort['publish']>[0]
      | Parameters<AssignmentNotificationPort['publish']>[0],
  ): Promise<void> {
    if ('detectionId' in input) {
      const resolved = input.assignee.status === 'RESOLVED';
      const isGroup = input.target.type === 'CHAT';
      const text = renderProposal(input, resolved);
      await this.notifications.publish(
        {
          target: input.target,
          text,
          buttons: resolved
            ? [
                {
                  text: isGroup ? '✅ Принять' : 'В дело',
                  payload: `hod:detection:confirm:${input.detectionId}`,
                  row: 0,
                },
                {
                  text: '👤 Изменить исполнителя',
                  payload: `hod:detection:assignees:${input.detectionId}:0`,
                  row: 1,
                },
                ...(!isGroup
                  ? [
                      {
                        text: 'Изменить детали в Mini App',
                        startParam: `detection_${input.detectionId}`,
                        row: 2,
                      },
                    ]
                  : []),
                {
                  text: isGroup ? '❌ Отменить' : 'Не нужно',
                  payload: `hod:detection:reject:${input.detectionId}`,
                  row: isGroup ? 2 : 3,
                },
              ]
            : [
                {
                  text: '👤 Выбрать исполнителя',
                  payload: `hod:detection:assignees:${input.detectionId}:0`,
                  row: 0,
                },
                ...(!isGroup
                  ? [
                      {
                        text: 'Изменить детали в Mini App',
                        startParam: `detection_${input.detectionId}`,
                        row: 1,
                      },
                    ]
                  : []),
                {
                  text: isGroup ? '❌ Отменить' : 'Не нужно',
                  payload: `hod:detection:reject:${input.detectionId}`,
                  row: isGroup ? 1 : 2,
                },
              ],
        },
        `proposal-${input.detectionId}`,
      );
      return;
    }

    await this.notifications.publish(
      {
        target: { type: 'USER', externalId: input.assigneeExternalUserId },
        text: `Новое дело\n\n${input.title}${input.creatorName ? `\n\nПостановщик: ${input.creatorName}` : ''}`,
        buttons: [
          { text: 'Принять', payload: `hod:action:accept:${input.actionId}`, row: 0 },
          {
            text: '📄 Открыть дело',
            payload: `hod:personal:action:detail:${input.actionId}`,
            row: 1,
          },
          { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 2 },
        ],
      },
      `assignment-${input.actionId}`,
    );
  }
}

function renderProposal(
  input: Parameters<DetectionProposalPort['publish']>[0],
  resolved: boolean,
): string {
  const candidate = input.candidate;
  const assignee = resolved
    ? (input.assigneeLabel ?? candidate.assigneeReference ?? 'определён')
    : `нужно уточнить (${input.assignee.status.toLocaleLowerCase('ru-RU')})`;
  const lines = [
    candidate.raw.confidenceBand === 'MEDIUM'
      ? 'ХОД нашёл возможное поручение — проверьте детали'
      : 'ХОД нашёл поручение',
    '',
    candidate.title ?? '',
    candidate.location ? `📍 ${candidate.location}` : null,
    `👤 ${assignee}`,
    candidate.deadlineRaw ? `📅 ${candidate.deadlineRaw}` : null,
    candidate.expectedResultType === 'PHOTO' ? '📷 результат: фото' : null,
    !resolved ? 'Исполнитель не определён однозначно — подтвердить дело пока нельзя.' : null,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}
