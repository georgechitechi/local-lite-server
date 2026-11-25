import { quoteIdent, type SqlExecutor } from 'local-lite/server';
import type { ServerSettings } from './config.js';
import { planSchema, type SchemaDictionary } from './schema.js';
import { coreMigrationStatus } from './migrations.js';
import type { AuthService } from './auth.js';

const escapeHtml = (v: string) =>
  v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const int = (v: string | null, d: number, min: number, max: number) =>
  Math.min(Math.max(Math.floor(Number(v ?? d)) || d, min), max);

export function createAdmin(
  s: ServerSettings,
  db: SqlExecutor,
  schema: SchemaDictionary,
  auth: AuthService,
) {
  const q = (n: string) => quoteIdent(n, db.dialect);

  return {
    async status(): Promise<Response> {
      const tables: Record<string, number> = {};
      for (const t of Object.keys(schema)) {
        tables[t] = Number((await db.query<any>(`SELECT COUNT(*) AS n FROM ${q(t)}`))[0]?.n ?? 0);
      }
      const clock = await db.query<any>('SELECT checkpoint FROM _server_sync_clock WHERE id = 1');
      const plan = await planSchema(db, schema).catch(() => null);
      return Response.json({
        dialect: s.dialect,
        database: s.db.database,
        cursor: Number(clock[0]?.checkpoint ?? 0),
        accounts: { enabled: auth.enabled, users: await auth.userCount() },
        smtp: Boolean(s.smtp),
        autoMigrate: s.autoMigrate,
        tables,
        core: await coreMigrationStatus(db),
        schemaPending: plan ? plan.up.length : null,
        schemaWarnings: plan?.warnings ?? [],
        serverTime: Date.now(),
      });
    },

    async rows(table: string, url: URL): Promise<Response> {
      if (!Object.hasOwn(schema, table)) return Response.json({ error: 'Unknown table.' }, { status: 404 });
      const limit = int(url.searchParams.get('limit'), 50, 1, 500);
      const offset = int(url.searchParams.get('offset'), 0, 0, 10_000_000);
      const rows = await db.query(
        `SELECT * FROM ${q(table)} ORDER BY ${q('updated_at')} DESC LIMIT ${limit} OFFSET ${offset}`,
      );
      return Response.json({ table, limit, offset, rows });
    },

    page(): Response {
      return new Response(ADMIN_HTML.replaceAll('__APP__', escapeHtml(s.appName)), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    },
  };
}

const ADMIN_HTML = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>__APP__ admin</title>
<style>body{font:14px system-ui;margin:0;background:#0f1115;color:#e6e6e6}main{max-width:960px;margin:auto;padding:20px}
input,button,select{font:inherit;padding:6px 10px;border-radius:6px;border:1px solid #3a3f4b;background:#1a1d24;color:inherit}
button{cursor:pointer}table{border-collapse:collapse;width:100%;margin-top:10px;font-size:12px}
td,th{border:1px solid #2a2e38;padding:4px 8px;text-align:left;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card{background:#171a21;border:1px solid #2a2e38;border-radius:10px;padding:12px;margin:12px 0}.warn{color:#f5b942}.err{color:#ff6b6b}</style>
<main><h2>__APP__ admin</h2>
<div class=card><input id=key type=password placeholder="SERVER_API_KEY" size=36> <button id=go>Connect</button> <span id=msg class=err></span></div>
<div id=out></div></main>
<script>
const $=s=>document.querySelector(s),key=$('#key');key.value=sessionStorage.k||'';
const api=async p=>{const r=await fetch(p,{headers:{authorization:'Bearer '+key.value}});if(!r.ok)throw new Error(r.status===401?'Invalid key':'Request failed ('+r.status+')');return r.json()};
const esc=v=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function load(){$('#msg').textContent='';try{const s=await api('/admin/status');sessionStorage.k=key.value;
$('#out').innerHTML='<div class=card><b>'+esc(s.dialect)+'</b> · '+esc(s.database)+' · cursor '+s.cursor+' · users '+s.accounts.users+(s.accounts.enabled?'':' (accounts disabled)')+' · smtp '+(s.smtp?'on':'off')+
(s.schemaPending?'<div class=warn>'+s.schemaPending+' pending schema change(s)</div>':'')+s.schemaWarnings.map(w=>'<div class=warn>'+esc(w)+'</div>').join('')+
'</div><div class=card>Tables: '+Object.entries(s.tables).map(([t,n])=>'<button data-t="'+esc(t)+'">'+esc(t)+' ('+n+')</button>').join(' ')+'</div><div id=rows></div>';
document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>rows(b.dataset.t))}catch(e){$('#msg').textContent=e.message}}
async function rows(t){const d=await api('/admin/tables/'+encodeURIComponent(t));const c=d.rows[0]?Object.keys(d.rows[0]):[];
$('#rows').innerHTML='<div class=card><b>'+esc(t)+'</b> (latest '+d.rows.length+')<table><tr>'+c.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr>'+d.rows.map(r=>'<tr>'+c.map(x=>'<td title="'+esc(r[x])+'">'+esc(typeof r[x]==='object'?JSON.stringify(r[x]):r[x])+'</td>').join('')+'</tr>').join('')+'</table></div>'}
$('#go').onclick=load;key.addEventListener('keydown',e=>{if(e.key==='Enter')load()});if(key.value)load();
</script>`;
