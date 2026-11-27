const PROJECT_STORAGE_KEY = 'lls_active_project_id';

export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(PROJECT_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveProjectId(id: string | null): void {
  try {
    if (id) localStorage.setItem(PROJECT_STORAGE_KEY, id);
    else localStorage.removeItem(PROJECT_STORAGE_KEY);
  } catch {}
}

export function buildApiUrl(path: string): string {
  const base = import.meta.env.DEV ? '/api' : '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

export async function adminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const pid = getActiveProjectId();
  if (pid && !headers.has('X-Project-Id')) {
    headers.set('X-Project-Id', pid);
  }
  const res = await fetch(buildApiUrl(path), {
    ...init,
    headers,
    credentials: 'include',
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event('lls:unauthorized'));
  }
  return res;
}

export async function parseJsonOrThrow<T = any>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || data?.message || fallbackMessage);
  }
  return data as T;
}
