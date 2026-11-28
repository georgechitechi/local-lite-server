export interface StatsPayload {
  server: {
    uptimeMs: number;
    dialect: string;
    multiInstance: boolean;
    nodeVersion: string;
    memoryMb: number;
  };
  sync: {
    checkpoint: number;
    compactedFloor: number;
    changeLogCount: number;
  };
  outbox: {
    pending: number;
    delivered: number;
    deadLetter: number;
  };
  ws: {
    connectedClients: number;
    activeLensSubs: number;
    presenceRooms: number;
    presenceMembers: number;
  };
  tables: Array<{ name: string; count: number }>;
  commands: Array<{ name: string; isolation: string }>;
  lenses: string[];
  projections: string[];
}

export function getStoredToken(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('token');
  if (fromQuery) {
    sessionStorage.setItem('lls_stats_token', fromQuery);
    return fromQuery;
  }
  return sessionStorage.getItem('lls_stats_token') ?? '';
}

export function setStoredToken(token: string) {
  sessionStorage.setItem('lls_stats_token', token.trim());
}

export async function apiFetch<T = any>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    rejected?: boolean;
  };
  if (!res.ok && !data.rejected) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
