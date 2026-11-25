const API_BASE_KEY = 'lls_api_base';

function isLocalhost(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' ||
      window.location.hostname === 'localhost')
  );
}

export function getApiBaseUrl(): string {
  if (import.meta.env.DEV) return '/api';
  const saved = localStorage.getItem(API_BASE_KEY)?.trim();
  if (saved) return saved.replace(/\/+$/, '');
  const envBase = (
    import.meta.env.VITE_API_BASE_URL as string | undefined
  )?.trim();
  return (envBase || '').replace(/\/+$/, '');
}

export function setApiBaseUrl(url: string): void {
  const cleaned = url.trim().replace(/\/+$/, '');
  if (cleaned) {
    localStorage.setItem(API_BASE_KEY, cleaned);
  } else {
    localStorage.removeItem(API_BASE_KEY);
  }
}

export function buildApiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

export async function adminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(buildApiUrl(path), {
    ...init,
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
