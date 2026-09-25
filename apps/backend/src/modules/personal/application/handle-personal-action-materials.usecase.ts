import type { ActionContextStore, ActionReadPort } from '../../actions';
import type { NotificationPublisher, OutboundNotification } from '../../notifications';
import type { InboundChatEvent, InboundChatEventHandler } from '../../workspaces';

const listPattern = /^hod:personal:materials:([0-9a-f-]{36}):(\d{1,4})$/i;
const previewPattern = /^hod:personal:material:([0-9a-f-]{36}):([0-9a-f-]{36}):(\d{1,4})$/i;
const pageSize = 5;

export class HandlePersonalActionMaterialsUseCase implements InboundChatEventHandler {
  constructor(
    private readonly contexts: ActionContextStore,
    private readonly actions: ActionReadPort,
    private readonly notifications: NotificationPublisher,
  ) {}

  async handle(event: InboundChatEvent): Promise<void> {
    if (event.kind !== 'message.callback' || !event.payload) return;
    const list = listPattern.exec(event.payload);
    const preview = previewPattern.exec(event.payload);
    if (!list && !preview) return;
    const actionId = (list ?? preview)![1]!;
    const externalUserId = event.actor.externalUserId;
    const actor = await this.contexts.resolveActor(actionId, externalUserId);
    const action = actor ? await this.actions.getDetail(actor.actorId, actionId, new Date()) : null;
    if (!action) {
      await this.notifications.publish(
        {
          target: { type: 'USER', externalId: externalUserId },
          text: 'Дело не найдено или у тебя нет доступа к его материалам.',
          buttons: [{ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 0 }],
        },
        `personal-materials-forbidden-${event.callbackId}`,
      );
      return;
    }
    if (preview) {
      const material = action.attachments.find((item) => item.id === preview[2]);
      await this.notifications.publish(
        {
          target: { type: 'USER', externalId: externalUserId },
          text: material
            ? `${material.mimeType.startsWith('image/') ? '📷' : '📎'} ${material.originalName}`
            : 'Материал больше недоступен.',
          ...(material
            ? { media: { attachmentId: material.id, requesterUserId: actor!.actorId } }
            : {}),
          buttons: [
            { text: '⬅️ К материалам', payload: listPayload(actionId, Number(preview[3])), row: 0 },
            { text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 1 },
          ],
        },
        `personal-material-preview-${event.callbackId}`,
      );
      return;
    }
    await this.notifications.publish(
      materialsPage(externalUserId, action, Number(list![2])),
      `personal-materials-${event.callbackId}`,
    );
  }
}

function materialsPage(
  externalUserId: string,
  action: NonNullable<Awaited<ReturnType<ActionReadPort['getDetail']>>>,
  requestedPage: number,
): OutboundNotification {
  const lastPage = Math.max(0, Math.ceil(action.attachments.length / pageSize) - 1);
  const page = Math.min(requestedPage, lastPage);
  const first = page * pageSize;
  const visible = action.attachments.slice(first, first + pageSize);
  const buttons: OutboundNotification['buttons'] = visible.map((material, index) => ({
    text: `${first + index + 1}. ${compactTitle(material.originalName, 28)}`,
    payload: `hod:personal:material:${action.id}:${material.id}:${page}`,
    row: index,
  }));
  if (page > 0)
    buttons.push({ text: '⬅️ Предыдущие', payload: listPayload(action.id, page - 1), row: 5 });
  if (page < lastPage)
    buttons.push({ text: '➡️ Ещё', payload: listPayload(action.id, page + 1), row: 5 });
  buttons.push({ text: '⬅️ К делу', payload: `hod:personal:action:detail:${action.id}`, row: 6 });
  buttons.push({ text: '🏠 Главное меню', payload: 'hod:personal:menu', row: 7 });
  const submittedComment = [...action.events]
    .reverse()
    .find((event) => event.type === 'RESULT_SUBMITTED')?.reason;
  const lines = visible.map(
    (material, index) =>
      `${first + index + 1}. ${material.mimeType.startsWith('image/') ? '📷' : '📎'} ${compactTitle(material.originalName, 90)}`,
  );
  return {
    target: { type: 'USER', externalId: externalUserId },
    text: [
      `Материалы дела «${compactTitle(action.title, 100)}» (${action.attachments.length}):`,
      lines.length ? lines.join('\n') : 'Вложений пока нет.',
      submittedComment ? `Комментарий к результату:\n${submittedComment}` : null,
    ]
      .filter(Boolean)
      .join('\n\n'),
    buttons,
  };
}

function listPayload(actionId: string, page: number): string {
  return `hod:personal:materials:${actionId}:${page}`;
}

function compactTitle(value: string, length: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  return chars.length > length ? `${chars.slice(0, length - 1).join('')}…` : clean;
}
