import type { ChiefSession, JobNotification, JobState } from './types';

export class ChiefApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ChiefApiError';
  }
}

async function request<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; csrf?: string } = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new ChiefApiError(0, 'Unsafe Chief API path.');
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.csrf) headers.set('X-Chief-CSRF', options.csrf);
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch {
    throw new ChiefApiError(0, 'Chief backend is unreachable.');
  }
  let payload: unknown = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const data = payload as { reason?: string; message?: string };
    throw new ChiefApiError(response.status, data.reason || data.message || `Chief API request failed (${response.status}).`);
  }
  return payload as T;
}

export const chiefApi = {
  session: () => request<ChiefSession>('/api/auth/session'),
  login: (username: string, password: string) => request<{ status: string; csrf: string }>('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: (csrf: string) => request<{ status: string }>('/api/auth/logout', { method: 'POST', body: {}, csrf }),
  jobState: () => request<JobState>('/api/ui/job-state'),
  jobNotifications: () => request<JobNotification[]>('/api/notifications?agent=jobs&sort=newest')
};
