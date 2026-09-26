import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionSummary } from '@hod/contracts';

import { App, ActionCard } from './app';
import { createAction, ensureSession, listActions } from './api';

vi.mock('./api', () => ({
  ensureSession: vi.fn(),
  listActions: vi.fn(),
  createAction: vi.fn(),
  getAction: vi.fn(),
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

describe('Mini App', () => {
  it('shows a server-authorized assigned list and the three MVP navigation views', async () => {
    renderWithClient(<App />);

    expect(await screen.findByRole('heading', { name: 'Мои дела' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: action.title })).toBeInTheDocument();
    expect(screen.getByText('Нужна проверка')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'От меня' })).toHaveAttribute('href', '/created');
    expect(screen.getByRole('link', { name: 'Команда' })).toHaveAttribute('href', '/team');
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
});

function renderWithClient(node: React.ReactNode, initialEntry = '/actions') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
