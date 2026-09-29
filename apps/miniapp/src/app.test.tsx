import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionDetail, ActionSummary } from '@hod/contracts';

import { App, ActionCard } from './app';
import {
  createAction,
  ensureSession,
  fetchAttachment,
  getAction,
  listActions,
  sendAttachmentToChat,
  transitionAction,
} from './api';

vi.mock('./api', () => ({
  ensureSession: vi.fn(),
  listActions: vi.fn(),
  createAction: vi.fn(),
  fetchAttachment: vi.fn(),
  getAction: vi.fn(),
  sendAttachmentToChat: vi.fn(),
  transitionAction: vi.fn(),
  uploadProof: vi.fn(),
  getDetection: vi.fn(),
  updateDetection: vi.fn(),
  confirmDetection: vi.fn(),
  getStartRoute: vi.fn(() => null),
}));

const action: ActionSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Проверить результат монтажа',
  status: 'DONE',
  deadlineKind: 'DATE_ONLY',
  deadlineAt: null,
  deadlineDate: '2026-09-20',
  deadlineDependency: null,
  deadlineRaw: null,
  location: 'Объект №3',
  expectedResultType: 'PHOTO',
  expectedResultText: null,
  creator: {
    id: '22222222-2222-4222-8222-222222222222',
    firstName: 'Алексей',
    lastName: null,
    username: null,
  },
  assignee: {
    id: '33333333-3333-4333-8333-333333333333',
    firstName: 'Антон',
    lastName: 'Соколов',
    username: null,
  },
  sourceChat: {
    id: '66666666-6666-4666-8666-666666666666',
    title: 'Монтажная бригада',
    context: 'GROUP',
  },
  attentionReasons: ['AWAITING_VERIFICATION'],
  updatedAt: '2026-09-20T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureSession).mockResolvedValue({
    id: action.assignee.id,
    firstName: action.assignee.firstName,
    lastName: action.assignee.lastName,
    externalUserId: '602',
  });
  vi.mocked(listActions).mockResolvedValue({ actions: [action] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Mini App', () => {
  it('shows a server-authorized assigned list and the primary navigation views', async () => {
    renderWithClient(<App />);

    expect(await screen.findByRole('heading', { name: 'Мои дела' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: action.title })).toBeInTheDocument();
    expect(screen.getByText('Нужна проверка')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'От меня' })).toHaveAttribute('href', '/created');
    expect(screen.queryByRole('link', { name: 'Команда' })).not.toBeInTheDocument();
    expect(ensureSession).toHaveBeenCalledOnce();
    expect(listActions).toHaveBeenCalledWith('assigned');
  });

  it('opens the create form and submits a personal action', async () => {
    vi.mocked(createAction).mockReturnValue(new Promise(() => {}));
    renderWithClient(<App />, '/actions/new');

    expect(await screen.findByRole('heading', { name: 'Создать дело' })).toBeInTheDocument();
    expect(screen.getByText('Дело будет создано для вас.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Подготовить презентацию' },
    });
    fireEvent.change(screen.getByLabelText('Описание'), {
      target: { value: 'К защите проекта' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать дело' }));

    await waitFor(() => expect(createAction).toHaveBeenCalledOnce());
    expect(createAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Подготовить презентацию',
        description: 'К защите проекта',
        deadlineKind: 'UNKNOWN',
      }),
    );
  });

  it('renders action status, assignee and attention reason as a navigable card', () => {
    renderWithClient(<ActionCard action={action} />);

    expect(screen.getByRole('link')).toHaveAttribute('href', `/actions/${action.id}`);
    expect(screen.getByText('На проверке')).toBeInTheDocument();
    expect(screen.getByText('Исполнитель: Антон Соколов')).toBeInTheDocument();
  });

  it('filters actions by the same categories as the bot and by deadline', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const activeToday: ActionSummary = {
      ...action,
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Дело на сегодня',
      status: 'IN_PROGRESS',
      deadlineDate: today,
      attentionReasons: ['DUE_TODAY'],
    };
    const overdue: ActionSummary = {
      ...action,
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Просроченное дело',
      status: 'ACCEPTED',
      deadlineDate: '2020-01-01',
      attentionReasons: ['OVERDUE'],
    };
    vi.mocked(listActions).mockResolvedValue({ actions: [action, activeToday, overdue] });

    renderWithClient(<App />);

    expect(await screen.findByRole('button', { name: /Активные · 2/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Активные · 2/ }));
    expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: activeToday.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: overdue.title })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Фильтр по сроку' }), {
      target: { value: 'today' },
    });
    expect(screen.getByRole('heading', { name: activeToday.title })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: overdue.title })).not.toBeInTheDocument();
    expect(screen.getByText('1 из 3')).toBeInTheDocument();
  });

  it('filters actions by their source chat and exposes desktop scroll controls', async () => {
    const personalAction: ActionSummary = {
      ...action,
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Личная задача',
      sourceChat: {
        id: '88888888-8888-4888-8888-888888888888',
        title: 'Личные дела',
        context: 'DIALOG',
      },
    };
    vi.mocked(listActions).mockResolvedValue({ actions: [action, personalAction] });

    renderWithClient(<App />);

    expect(await screen.findByRole('option', { name: 'Монтажная бригада' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Личные дела' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Прокрутить фильтры влево' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Прокрутить фильтры вправо' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Фильтр по беседе' }), {
      target: { value: personalAction.sourceChat.id },
    });
    expect(screen.getByRole('heading', { name: personalAction.title })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: action.title })).not.toBeInTheDocument();
    expect(screen.getByText('1 из 1')).toBeInTheDocument();
  });

  it('opens photos in-app, downloads files and hides an empty action panel', async () => {
    const detail: ActionDetail = {
      ...action,
      description: null,
      sourceContext: [],
      events: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          type: 'RESULT_SUBMITTED',
          fromStatus: 'IN_PROGRESS',
          toStatus: 'DONE',
          reason: 'Работа выполнена, добавил подтверждение.',
          createdAt: '2026-09-20T09:58:00.000Z',
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          type: 'ACTION_STARTED',
          fromStatus: 'ACCEPTED',
          toStatus: 'IN_PROGRESS',
          reason: null,
          createdAt: '2026-09-20T08:00:00.000Z',
        },
      ],
      attachments: [
        {
          id: '99999999-9999-4999-8999-999999999999',
          originalName: 'result.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          downloadUrl: '/api/attachments/99999999-9999-4999-8999-999999999999',
          createdAt: '2026-09-20T10:00:00.000Z',
        },
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          originalName: 'FIXED.txt',
          mimeType: 'text/plain',
          sizeBytes: 32,
          downloadUrl: '/api/attachments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          createdAt: '2026-09-20T10:01:00.000Z',
        },
      ],
    };
    vi.mocked(getAction).mockResolvedValue(detail);
    vi.mocked(fetchAttachment).mockResolvedValue(new Blob(['fixed']));
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixed');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let downloadedName = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download;
    });

    renderWithClient(<App />, `/actions/${action.id}`);

    const preview = await screen.findByRole('img', { name: 'result.jpg' });
    expect(preview).toHaveAttribute('src', detail.attachments[0]!.downloadUrl);
    expect(screen.getByRole('heading', { name: 'Комментарии' })).toBeInTheDocument();
    expect(screen.getByText('Работа выполнена, добавил подтверждение.')).toBeInTheDocument();
    expect(screen.getByText(/Комментарий исполнителя/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Открыть фото/ }));
    const viewer = screen.getByRole('dialog', { name: 'Просмотр result.jpg' });
    expect(within(viewer).getByRole('img', { name: 'result.jpg' })).toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole('button', { name: 'Закрыть фото' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'FIXED.txt' }));
    await waitFor(() =>
      expect(fetchAttachment).toHaveBeenCalledWith(detail.attachments[1]!.downloadUrl),
    );
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:fixed');
    expect(downloadedName).toBe('FIXED.txt');
    expect(screen.queryByRole('region', { name: 'Действия с делом' })).not.toBeInTheDocument();

    click.mockRestore();
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it('sends a phone attachment to the bot without attempting a browser download', async () => {
    vi.stubGlobal('WebApp', { platform: 'ios' });
    vi.mocked(getAction).mockResolvedValue({
      ...action,
      description: null,
      sourceContext: [],
      events: [],
      attachments: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          originalName: 'FIXED.txt',
          mimeType: 'text/plain',
          sizeBytes: 32,
          downloadUrl: '/api/attachments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          createdAt: '2026-09-20T10:01:00.000Z',
        },
      ],
    });

    renderWithClient(<App />, `/actions/${action.id}`);

    expect(await screen.findByText('FIXED.txt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'FIXED.txt' })).not.toBeInTheDocument();
    expect(fetchAttachment).not.toHaveBeenCalled();

    vi.mocked(sendAttachmentToChat).mockResolvedValue();
    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть FIXED.txt в боте' }));
    await waitFor(() =>
      expect(sendAttachmentToChat).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    );
    expect(await screen.findByText(/Файл отправляется в чат с ботом/)).toBeInTheDocument();
  });

  it('shows an error if the bot cannot receive a phone attachment', async () => {
    vi.stubGlobal('WebApp', { platform: 'android' });
    vi.mocked(sendAttachmentToChat).mockRejectedValue(new Error('Файл недоступен'));
    vi.mocked(getAction).mockResolvedValue({
      ...action,
      description: null,
      sourceContext: [],
      events: [],
      attachments: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          originalName: 'FIXED.txt',
          mimeType: 'text/plain',
          sizeBytes: 32,
          downloadUrl: '/api/attachments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          createdAt: '2026-09-20T10:01:00.000Z',
        },
      ],
    });

    renderWithClient(<App />, `/actions/${action.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Посмотреть FIXED.txt в боте' }));

    expect(await screen.findByText('Файл недоступен')).toBeInTheDocument();
    expect(fetchAttachment).not.toHaveBeenCalled();
  });

  it('lets the creator remove a rejected action after confirmation', async () => {
    vi.mocked(ensureSession).mockResolvedValue({
      id: action.creator.id,
      firstName: action.creator.firstName,
      lastName: action.creator.lastName,
      externalUserId: '601',
    });
    vi.mocked(getAction).mockResolvedValue({
      ...action,
      status: 'REJECTED',
      description: null,
      sourceContext: [],
      events: [],
      attachments: [],
    });
    vi.mocked(transitionAction).mockResolvedValue({ status: 'CANCELLED', idempotent: false });

    renderWithClient(<App />, `/actions/${action.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить дело' }));
    expect(
      screen.getByText('Дело исчезнет из списков, но история сохранится.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }));

    await waitFor(() => expect(transitionAction).toHaveBeenCalledOnce());
    expect(vi.mocked(transitionAction).mock.calls[0]?.[0]).toBe(action.id);
    expect(vi.mocked(transitionAction).mock.calls[0]?.[1].command).toBe('CANCEL');
    expect(vi.mocked(transitionAction).mock.calls[0]?.[1].idempotencyKey).toEqual(
      expect.any(String),
    );
  });
});

function renderWithClient(node: React.ReactNode, initialEntry = '/actions') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
