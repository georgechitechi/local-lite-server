import { resolveUnifiedUserId } from 'local-lite/auth';

const CACHE_TTL_MS = 5 * 60 * 1000;
const tokenCache = new Map<string, { userId: string; expiresAt: number }>();

function parseBodyParams(rawText: string): Record<string, string> | null {
  if (rawText.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v != null) out[k] = String(v);
      }
      return out;
    } catch {
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(rawText).entries());
}

/** Handles `POST /auth/google-token` and `POST /auth/github-token` code exchanges. */
export async function handleOAuthTokenExchange(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawText = await request.text().catch(() => '');
  const params = parseBodyParams(rawText);
  if (!params) {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (url.pathname.endsWith('/google-token')) {
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientSecret) {
      return Response.json(
        { error: 'Google OAuth client secret is not configured on the server' },
        { status: 503 },
      );
    }
    if (params.grant_type !== 'authorization_code' && params.grant_type !== 'refresh_token') {
      return Response.json(
        { error: 'Unsupported grant_type. Expected authorization_code or refresh_token.' },
        { status: 400 },
      );
    }
    const forwarded = new URLSearchParams();
    for (const f of ['grant_type', 'client_id', 'code', 'code_verifier', 'redirect_uri', 'refresh_token']) {
      if (params[f]) forwarded.set(f, params[f]);
    }
    forwarded.set('client_secret', clientSecret);

    const gRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: forwarded.toString(),
    });
    return new Response(await gRes.text(), {
      status: gRes.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (url.pathname.endsWith('/github-token')) {
    const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
    if (!clientSecret) {
      return Response.json(
        { error: 'GITHUB_CLIENT_SECRET is not configured on server' },
        { status: 503 },
      );
    }
    const { client_id, code, redirect_uri, state } = params;
    if (!code || !client_id) {
      return Response.json({ error: 'client_id and code are required' }, { status: 400 });
    }
    const forwarded = new URLSearchParams({ client_id, client_secret: clientSecret, code });
    if (redirect_uri) forwarded.set('redirect_uri', redirect_uri);
    if (state) forwarded.set('state', state);

    const ghRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: forwarded.toString(),
    });
    return new Response(await ghRes.text(), {
      status: ghRes.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  return Response.json({ error: 'Endpoint not found' }, { status: 404 });
}

function cacheUser(token: string, userId: string): { id: string } {
  if (tokenCache.size > 2000) tokenCache.clear();
  tokenCache.set(token, { userId, expiresAt: Date.now() + CACHE_TTL_MS });
  return { id: userId };
}

/** Verifies a Google (ID/access) or GitHub OAuth token and maps it to a unified userId. */
export async function verifyOAuthToken(token: string): Promise<{ id: string } | null> {
  if (!token || token.length < 16) return null;
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return { id: cached.userId };

  try {
    const isGitHubPrefix =
      token.startsWith('gho_') || token.startsWith('ghu_') || token.startsWith('ghp_');

    if (!isGitHubPrefix && token.split('.').length === 3) {
      const gRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (gRes.ok) {
        const info = (await gRes.json()) as any;
        if (typeof info?.sub === 'string' && info.sub) {
          const id = resolveUnifiedUserId(
            {
              id: info.sub,
              email: info.email,
              emailVerified: info.email_verified === true || info.email_verified === 'true',
            },
            'google',
          );
          return cacheUser(token, id);
        }
      }
    }

    if (!isGitHubPrefix) {
      const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        signal: AbortSignal.timeout(8_000),
        headers: { Authorization: `Bearer ${token}` },
      });
      if (uRes.ok) {
        const info = (await uRes.json()) as any;
        if (typeof info?.sub === 'string' && info.sub) {
          const id = resolveUnifiedUserId(
            {
              id: info.sub,
              email: info.email,
              emailVerified: info.email_verified === true || info.email_verified === 'true',
            },
            'google',
          );
          return cacheUser(token, id);
        }
      }
    }

    const ghRes = await fetch('https://api.github.com/user', {
      signal: AbortSignal.timeout(8_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'local-lite-server',
      },
    });
    if (ghRes.ok) {
      const info = (await ghRes.json()) as any;
      if (info?.id != null) {
        const id = resolveUnifiedUserId(
          { id: String(info.id), email: info.email ?? undefined, emailVerified: Boolean(info.email) },
          'github',
        );
        return cacheUser(token, id);
      }
    }
  } catch {
    // Ignore transient upstream OAuth errors
  }

  return null;
}

export function clearOAuthCacheForTests() {
  tokenCache.clear();
}
