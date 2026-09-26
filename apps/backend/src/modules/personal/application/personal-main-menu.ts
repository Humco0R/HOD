import type { OutboundNotification } from '../../notifications';

export function personalMainMenu(externalUserId: string): OutboundNotification {
  return {
    target: { type: 'USER', externalId: externalUserId },
    text: `Привет! Я ХОД 👋

Я помогаю превращать сообщения из MAX в дела и не забывать о них.

Чтобы создать дело, нажми кнопку ниже или перешли мне сообщение с задачей.

Выбери, что хочешь сделать:`,
    buttons: [
      { text: '➕ Создать дело', payload: 'hod:personal:create', row: 0 },
      { text: '📋 Мои дела', payload: 'hod:personal:actions', row: 1 },
      { text: '❓ Как это работает?', payload: 'hod:personal:help', row: 2 },
    ],
  };
}
