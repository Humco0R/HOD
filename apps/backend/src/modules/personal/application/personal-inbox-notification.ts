import { createHash } from 'node:crypto';

import type { NotificationPublisher } from '../../notifications';

export function publishPersonalHelp(
  notifications: NotificationPublisher,
  externalUserId: string,
  text: string,
  eventId: string,
): Promise<void> {
  return notifications.publish(
    {
      target: { type: 'USER', externalId: externalUserId },
      text,
      buttons: [
        { text: '➕ Создать дело', payload: 'hod:personal:create', row: 0 },
        { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 1 },
      ],
    },
    notificationId('personal-help', eventId),
  );
}

export function notificationId(kind: string, eventId: string): string {
  return `${kind}-${createHash('sha256').update(eventId).digest('hex')}`;
}
