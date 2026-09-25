import type { DetectionDetail } from '@hod/contracts';

import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';
import { DetectionAccessDeniedError } from '../domain/detection-access-denied.error';

export interface DetectionChatManagementPort {
  getForExternalUser(detectionId: string, externalUserId: string): Promise<DetectionDetail | null>;
  chooseAssignee(detectionId: string, externalUserId: string, assigneeId: string): Promise<void>;
}

const listPattern = /^hod:detection:assignees:([0-9a-f-]{36}):(\d{1,4})$/i;
const choosePattern = /^hod:detection:assignee:([0-9a-f-]{36}):([0-9a-f-]{36})$/i;
const pageSize = 5;

export class HandleDetectionAssigneeUseCase implements InboundChatEventHandler {
  constructor(
    private readonly management: DetectionChatManagementPort,
    private readonly notifications: NotificationPublisher,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind !== 'message.callback' || !event.payload) return;
    const list = listPattern.exec(event.payload);
    const choose = choosePattern.exec(event.payload);
    if (!list && !choose) return;
    const detectionId = (list ?? choose)![1]!;
    const userId = event.actor.externalUserId;
    const target: OutboundNotification['target'] = event.externalChatId
      ? { type: 'CHAT', externalId: event.externalChatId }
      : { type: 'USER', externalId: userId };
    try {
      if (choose) {
        await this.management.chooseAssignee(detectionId, userId, choose[2]!);
      }
      const detail = await this.management.getForExternalUser(detectionId, userId);
      if (!detail) throw new DetectionAccessDeniedError();
      if (detail.status !== 'PENDING') {
        await this.publish(target, 'Предложение больше не доступно.', [], event.callbackId);
        return;
      }
      await this.notifications.publish(
        choose ? selectedCard(target, detail) : assigneePage(target, detail, Number(list![2])),
        `detection-assignee-${event.callbackId}`,
      );
    } catch (error) {
      if (error instanceof DetectionAccessDeniedError) throw error;
      await this.publish(
        target,
        'Не удалось выбрать исполнителя. Проверь права и открой список заново.',
        [
          {
            text: '👤 Выбрать исполнителя',
            payload: `hod:detection:assignees:${detectionId}:0`,
            row: 0,
          },
        ],
        event.callbackId,
      );
    }
  }

  private publish(
    target: OutboundNotification['target'],
    text: string,
    buttons: OutboundNotification['buttons'],
    callbackId: string,
  ): Promise<void> {
    return this.notifications.publish(
      { target, text, buttons },
      `detection-assignee-${callbackId}`,
    );
  }
}

function assigneePage(
  target: OutboundNotification['target'],
  detail: DetectionDetail,
  requestedPage: number,
): OutboundNotification {
  const members = [...detail.members].sort((a, b) =>
    memberLabel(a).localeCompare(memberLabel(b), 'ru'),
  );
  const lastPage = Math.max(0, Math.ceil(members.length / pageSize) - 1);
  const page = Math.min(requestedPage, lastPage);
  const visible = members.slice(page * pageSize, (page + 1) * pageSize);
  const buttons: OutboundNotification['buttons'] = visible.map((member, index) => ({
    text: `${page * pageSize + index + 1}. ${memberLabel(member).slice(0, 40)}${members.filter((item) => memberLabel(item) === memberLabel(member)).length > 1 ? ` · ${member.id.slice(-6)}` : ''}`,
    payload: `hod:detection:assignee:${detail.id}:${member.id}`,
    row: index,
  }));
  if (page > 0)
    buttons.push({
      text: '⬅️ Предыдущие',
      payload: `hod:detection:assignees:${detail.id}:${page - 1}`,
      row: 5,
    });
  if (page < lastPage)
    buttons.push({
      text: '➡️ Ещё',
      payload: `hod:detection:assignees:${detail.id}:${page + 1}`,
      row: 5,
    });
  if (detail.assigneeId)
    buttons.push({
      text: '⬅️ К предложению',
      payload: `hod:detection:assignee:${detail.id}:${detail.assigneeId}`,
      row: 6,
    });
  if (target.type === 'USER')
    buttons.push({ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 7 });
  return {
    target,
    text: `Выбери исполнителя для дела «${detail.title}»\n\n${members.length ? `Участники: ${members.length}. Страница ${page + 1} из ${lastPage + 1}.` : 'В команде нет доступных участников.'}`,
    buttons,
  };
}

function selectedCard(
  target: OutboundNotification['target'],
  detail: DetectionDetail,
): OutboundNotification {
  const member = detail.members.find((item) => item.id === detail.assigneeId);
  return {
    target,
    text: `ХОД нашёл поручение\n\n${detail.title}\n👤 Исполнитель: ${member ? memberLabel(member) : 'не найден'}`,
    buttons: [
      { text: '✅ В дело', payload: `hod:detection:confirm:${detail.id}`, row: 0 },
      {
        text: '👤 Изменить исполнителя',
        payload: `hod:detection:assignees:${detail.id}:0`,
        row: 1,
      },
      { text: '❌ Не нужно', payload: `hod:detection:reject:${detail.id}`, row: 2 },
      ...(target.type === 'USER'
        ? [{ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 3 }]
        : []),
    ],
  };
}

function memberLabel(member: DetectionDetail['members'][number]): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
  return `${name || 'Без имени'}${member.username ? ` (@${member.username})` : ''}`;
}
