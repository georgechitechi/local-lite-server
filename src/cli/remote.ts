import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { loadRulesFile, resolveRulesFile } from '../db/rules.js';
import { loadSchemaFile, resolveSchemaFile, type SchemaDictionary } from '../db/schema.js';
import { writeClientCode } from '../services/codegen.js';

interface CliAuthState {
  url: string;
  cookie: string;
  email: string;
}

const AUTH_FILE = path.join(os.homedir(), '.local-lite-server', 'auth.json');

function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : undefined;
}

function readAuth(): CliAuthState | null {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as CliAuthState;
    return parsed?.url && parsed?.cookie ? parsed : null;
  } catch {
    return null;
  }
}

function saveAuth(state: CliAuthState) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function resolveRemote(args: string[]): { url: string; headers: Record<string, string> } {
  const saved = readAuth();
  const url = (flag(args, '--url') || process.env.LLS_URL || saved?.url || '').replace(/\/+$/, '');
  if (!url) {
    throw new Error('Not logged in. Run `local-lite-server login --url <server-url>` first.');
  }
  const apiKey = flag(args, '--key') || process.env.LLS_API_KEY || process.env.SERVER_API_KEY;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  else if (saved?.cookie) headers.cookie = saved.cookie;
  else throw new Error('Missing credentials. Run `local-lite-server login` or pass `--key <api-key>`.');
  return { url, headers };
}

async function apiJson<T = any>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

function openBrowser(targetUrl: string) {
  const plat = process.platform;
  if (plat === 'win32') {
    spawn('powershell', ['-NoProfile', '-Command', `Start-Process '${targetUrl.replace(/'/g, "''")}'`], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  } else if (plat === 'darwin') {
    spawn('open', [targetUrl], { stdio: 'ignore', detached: true }).unref();
  } else {
    spawn('xdg-open', [targetUrl], { stdio: 'ignore', detached: true }).unref();
  }
}

async function loginViaBrowser(url: string, signup: boolean): Promise<{ token: string; email: string }> {
  const state = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404).end('Not Found');
        return;
      }
      const token = reqUrl.searchParams.get('token') ?? '';
      const email = reqUrl.searchParams.get('email') ?? 'admin';
      const gotState = reqUrl.searchParams.get('state') ?? '';
      if (!token || gotState !== state) {
        res.writeHead(400, { 'content-type': 'text/html' }).end('<h3>Login failed: invalid state or token.</h3>');
        clearTimeout(timer);
        server.close();
        reject(new Error('Browser login failed (invalid state or token).'));
        return;
      }
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<html><body style="font-family:sans-serif;padding:32px;background:#0c0d10;color:#f4f4f5"><h2>Logged in to local-lite-server CLI</h2><p>You can close this browser tab and return to your terminal.</p></body></html>');
      clearTimeout(timer);
      server.close();
      resolve({ token, email });
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Login timed out after 3 minutes.'));
    }, 180_000);

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const callbackUrl = `http://127.0.0.1:${addr.port}/callback`;
      const target = new URL(`${url}/admin`);
      target.searchParams.set('cli_redirect', callbackUrl);
      target.searchParams.set('cli_state', state);
      if (signup) target.searchParams.set('signup', '1');
      console.log(`Opening browser to log in:\n  ${target.toString()}`);
      openBrowser(target.toString());
    });
  });
}

export async function runCliLogin(args: string[]) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const saved = readAuth();
    const defaultUrl = saved?.url || `http://127.0.0.1:${process.env.SERVER_PORT || 3000}`;
    const rawUrl =
      flag(args, '--url') ||
      process.env.LLS_URL ||
      (await rl.question(`Server URL [${defaultUrl}]: `)) ||
      defaultUrl;
    const url = rawUrl.trim().replace(/\/+$/, '');

    const emailFlag = flag(args, '--email');
    const passwordFlag = flag(args, '--password');
    const signup = args.includes('--signup');

    if (!emailFlag && !passwordFlag) {
      rl.close();
      const { token, email } = await loginViaBrowser(url, signup);
      saveAuth({ url, cookie: `lls_admin_session=${token}`, email });
      console.log(`Logged in as ${email} on ${url}`);
      return;
    }

    const email = (emailFlag || (await rl.question('Email: '))).trim();
    const password = passwordFlag || (await rl.question('Password: '));
    const name = signup ? flag(args, '--name') || (await rl.question('Name (optional): ')).trim() : undefined;

    const res = await fetch(`${url}/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: signup ? 'signup' : 'login',
        email,
        password,
        ...(name ? { name } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new Error(data?.error || `Login failed (${res.status})`);

    const setCookie = res.headers.get('set-cookie') ?? '';
    const match = setCookie.match(/lls_admin_session=[^;]+/);
    if (!match) throw new Error('Server did not return a session cookie.');

    saveAuth({ url, cookie: match[0], email });
    console.log(`Logged in as ${email} on ${url}`);
  } finally {
    rl.close();
  }
}

export function runCliLogout() {
  if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
  console.log('Logged out.');
}

async function loadLocalSchemaAndRules(args: string[]): Promise<{
  schema?: SchemaDictionary;
  rules?: Record<string, any>;
}> {
  const schemaPath = resolveSchemaFile(flag(args, '--schema'));
  const rulesPath = resolveRulesFile(flag(args, '--rules'));
  return {
    schema: schemaPath ? await loadSchemaFile(schemaPath) : undefined,
    rules: rulesPath ? await loadRulesFile(rulesPath) : undefined,
  };
}

export async function runCliProjects(sub: string | undefined, args: string[]) {
  const { url, headers } = resolveRemote(args);

  if (!sub || sub === 'list') {
    const { projects } = await apiJson<{ projects: any[] }>(`${url}/projects`, { headers });
    if (!projects.length) {
      console.log('No projects found. Create one with: local-lite-server projects create <name>');
      return;
    }
    for (const p of projects) {
      const tables = Object.keys(p.schema ?? {}).length;
      console.log(`${p.slug}\t${p.name}\t(${p.id})\t${tables} tables\t${url}/p/${p.slug}/sync`);
    }
    return;
  }

  if (sub === 'create') {
    const name = args.find((a) => !a.startsWith('-'));
    if (!name) throw new Error('Usage: local-lite-server projects create <name> [--slug <slug>] [--schema schema.ts]');
    const slug = flag(args, '--slug');
    const local = await loadLocalSchemaAndRules(args);
    const { project } = await apiJson<{ project: any }>(`${url}/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, slug, schema: local.schema, rules: local.rules }),
    });
    console.log(`Created project "${project.name}" (${project.slug})`);
    console.log(`Sync URL: ${url}/p/${project.slug}/sync`);
    return;
  }

  if (sub === 'delete') {
    const idOrSlug = args.find((a) => !a.startsWith('-'));
    if (!idOrSlug) throw new Error('Usage: local-lite-server projects delete <id-or-slug>');
    await apiJson(`${url}/projects/${encodeURIComponent(idOrSlug)}`, { method: 'DELETE', headers });
    console.log(`Deleted project "${idOrSlug}"`);
    return;
  }

  throw new Error('Usage: local-lite-server projects <list|create|delete>');
}

export async function runCliPush(args: string[]) {
  const { url, headers } = resolveRemote(args);
  const projectRef = flag(args, '--project') || args.find((a) => !a.startsWith('-'));
  if (!projectRef) throw new Error('Usage: local-lite-server push --project <slug-or-id> [--schema schema.ts]');
  const local = await loadLocalSchemaAndRules(args);
  if (!local.schema) throw new Error('No schema file found. Create schema.ts or pass --schema <path>.');
  const res = await apiJson<{ applied: number; warnings: string[]; project: any }>(
    `${url}/projects/${encodeURIComponent(projectRef)}/schema`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ schema: local.schema, rules: local.rules }),
    },
  );
  console.log(`Pushed schema to "${res.project.slug}" (${res.applied} SQL change(s) applied).`);
  for (const w of res.warnings ?? []) console.log(`warning: ${w}`);
}

export async function runCliRemoteCodegen(args: string[], projectRef: string, outFile: string) {
  const { url, headers } = resolveRemote(args);
  const { projects } = await apiJson<{ projects: any[] }>(`${url}/projects`, { headers });
  const project = projects.find((p) => p.id === projectRef || p.slug === projectRef);
  if (!project) throw new Error(`Project "${projectRef}" not found.`);
  const abs = writeClientCode(outFile, project.schema ?? {}, new Map());
  console.log(`Generated typed client SDK for "${project.slug}": ${abs}`);
}
