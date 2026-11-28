import crypto from 'node:crypto';
import http from 'node:http';
import type { ServerSettings } from '../config.js';

const MAX_BODY_BYTES = 6_000_000;

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function corsHeaders(
  request: Request,
  s: ServerSettings,
): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowAll = s.corsOrigins.includes('*');
  const allowed = allowAll
    ? '*'
    : origin && s.corsOrigins.includes(origin)
      ? origin
      : '';
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization,Content-Type,X-API-Key,X-Captcha-Token',
    'Access-Control-Max-Age': '600',
  };
  if (allowed) h['Access-Control-Allow-Origin'] = allowed;
  if (allowed && allowed !== '*')
    h['Access-Control-Allow-Credentials'] = 'true';
  if (!allowAll) h['Vary'] = 'Origin';
  return h;
}

/** Node `http.Server` -> Web `Request`/`Response` bridge with streaming SSE support. */
export function createHttpServer(app: {
  fetch(req: Request): Promise<Response>;
}) {
  return http.createServer(async (req, res) => {
    try {
      const proto =
        req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const url = `${proto}://${req.headers.host ?? 'localhost'}${req.url}`;
      const chunks: Buffer[] = [];
      let size = 0;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body is too large.' }));
            return;
          }
          chunks.push(chunk);
        }
      }
      const init: RequestInit & { duplex?: string } = {
        method: req.method,
        headers: req.headers as Record<string, string>,
      };
      if (chunks.length) {
        init.body = Buffer.concat(chunks);
        init.duplex = 'half';
      }
      const response = await app.fetch(new Request(url, init));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) return void res.end();
      const reader = response.body.getReader();
      res.on('close', () => void reader.cancel().catch(() => {}));
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (error) {
      console.error('[local-lite-server]', error);
      if (!res.headersSent)
        res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request failed.' }));
    }
  });
}
