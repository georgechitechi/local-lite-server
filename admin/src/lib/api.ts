export function buildApiUrl(path: string): string {
  const base = import.meta.env.DEV ? '/api' : '';
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
