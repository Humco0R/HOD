import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionSummary } from '@hod/contracts';

import { App, ActionCard } from './app';
import { ensureSession, listActions } from './api';

vi.mock('./api', () => ({
  ensureSession: vi.fn(),
  listActions: vi.fn(),
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

    expect(await screen.findByRole('heading', { name: 'Дела' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: action.title })).toBeInTheDocument();
    expect(screen.getByText('Нужна проверка')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'От меня' })).toHaveAttribute('href', '/created');
    expect(screen.getByRole('link', { name: 'Команда' })).toHaveAttribute('href', '/team');
    expect(ensureSession).toHaveBeenCalledOnce();
    expect(listActions).toHaveBeenCalledWith('assigned');
  });

  it('renders action status, assignee and attention reason as a navigable card', () => {
    renderWithClient(<ActionCard action={action} />);

    expect(screen.getByRole('link')).toHaveAttribute('href', `/actions/${action.id}`);
    expect(screen.getByText('На проверке')).toBeInTheDocument();
    expect(screen.getByText('Исполнитель: Антон Соколов')).toBeInTheDocument();
  });
});

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/actions']}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
