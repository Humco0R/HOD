import type {
  ActionDetail,
  ActionSummary,
  CreateActionRequestDto,
  CreateActionResponseDto,
  CurrentUser,
  DetectionDetail,
  DetectionEdit,
  TransitionActionRequestDto,
} from '@hod/contracts';

declare global {
  interface Window {
    WebApp?: {
      initData?: string;
      initDataUnsafe?: { start_param?: string };
      ready?: () => void;
      expand?: () => void;
    };
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new ApiError(
      body?.message ?? body?.error ?? `HTTP ${String(response.status)}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function json(body: unknown): Pick<RequestInit, 'body' | 'headers'> {
  return { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

function maxInitData(): string | null {
  if (window.WebApp?.initData) return window.WebApp.initData;
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('WebAppData');
}

export async function ensureSession(): Promise<CurrentUser> {
  try {
    return await request<CurrentUser>('/api/me');
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  const initData = maxInitData();
  if (!initData) {
    try {
      return await request<CurrentUser>('/api/auth/dev', { method: 'POST', ...json({}) });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      throw new Error('Откройте ХОД из MAX, чтобы подтвердить личность.', { cause: error });
    }
  }
  return request<CurrentUser>('/api/auth/max', { method: 'POST', ...json({ initData }) });
}

export async function listActions(view: 'assigned' | 'created' | 'team') {
  return request<{ actions: ActionSummary[] }>(`/api/actions?view=${view}`);
}

export async function createAction(body: CreateActionRequestDto) {
  return request<CreateActionResponseDto>('/api/actions', { method: 'POST', ...json(body) });
}

export async function getAction(id: string) {
  return request<ActionDetail>(`/api/actions/${id}`);
}

export async function transitionAction(id: string, body: TransitionActionRequestDto) {
  return request<{ status: ActionDetail['status']; idempotent: boolean }>(
    `/api/actions/${id}/transitions`,
    {
      method: 'POST',
      ...json(body),
    },
  );
}

export async function uploadProof(id: string, file: File) {
  const body = new FormData();
  body.append('proof', file);
  return request<{ id: string }>(`/api/actions/${id}/attachments`, { method: 'POST', body });
}

export async function getDetection(id: string) {
  return request<DetectionDetail>(`/api/detections/${id}`);
}

export async function updateDetection(id: string, edit: DetectionEdit) {
  return request<DetectionDetail>(`/api/detections/${id}`, { method: 'PATCH', ...json(edit) });
}

export async function confirmDetection(id: string) {
  return request<{ actionId: string }>(`/api/detections/${id}/confirm`, {
    method: 'POST',
    ...json({ idempotencyKey: crypto.randomUUID() }),
  });
}

export function getStartRoute(): string | null {
  const start = window.WebApp?.initDataUnsafe?.start_param;
  if (!start) return null;
  if (start.startsWith('action_')) return `/actions/${start.slice('action_'.length)}`;
  if (start.startsWith('detection_')) return `/detections/${start.slice('detection_'.length)}`;
  return null;
}
