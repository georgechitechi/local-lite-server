export function renderAdminHtml(appName: string): string {
  return ADMIN_HTML.replaceAll('__APP__', escapeHtml(appName));
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__APP__ — Admin Console</title>
<style>
:root{
  --bg:#0c0d10;--sidebar:#111217;--surface:#16181f;--surface-alt:#1e2029;--surface-hover:#252834;
  --border:#272a36;--text:#f4f4f5;--muted:#9ca3af;--accent:#9e78dc;--accent-soft:rgba(158,120,220,.14);
  --success:#4ade80;--success-soft:rgba(74,222,128,.14);--danger:#f87171;--danger-soft:rgba(248,113,113,.14);
  --warn:#fbbf24;--warn-soft:rgba(251,191,36,.14);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;font-size:14px}
button,input,textarea,select{font:inherit;color:inherit}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#2e313d;border-radius:4px}

.gate{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.gate-card{width:100%;max-width:420px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px}
.shell{display:flex;min-height:100vh}
.sidebar{width:240px;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--sidebar);border-right:1px solid var(--border);display:flex;flex-direction:column;justify-content:space-between;padding:18px 12px}
.nav-item{width:100%;display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;border:none;background:transparent;color:var(--muted);cursor:pointer;text-align:left;font-size:13.5px;font-weight:500;transition:background .15s,color .15s}
.nav-item:hover{background:var(--surface-alt);color:var(--text)}
.nav-item.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
.main{flex:1;min-width:0;padding:24px 28px;max-width:1320px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px}
.pill{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--surface-alt);color:var(--muted);font-weight:600}
.pill.ok{background:var(--success-soft);color:var(--success)}
.pill.warn{background:var(--warn-soft);color:var(--warn)}
.pill.err{background:var(--danger-soft);color:var(--danger)}
.pill.accent{background:var(--accent-soft);color:var(--accent)}

.btn{padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);font-size:13px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.btn:hover{background:var(--surface-hover)}
.btn.primary{background:var(--accent);border-color:transparent;color:#fff;font-weight:600}
.btn.primary:hover{filter:brightness(1.08)}
.btn.danger{background:var(--danger-soft);border-color:transparent;color:var(--danger)}
.btn.sm{padding:5px 10px;font-size:12px}
.input,.select,.textarea{width:100%;padding:8px 11px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px}
.textarea{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;min-height:110px;resize:vertical}
.label{font-size:12px;color:var(--muted);margin-bottom:6px;display:block}
.muted{color:var(--muted);font-size:12.5px}

.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--border);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
th{background:var(--sidebar);color:var(--muted);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;position:sticky;top:0}
tr.clickable{cursor:pointer}
tr.clickable:hover td{background:var(--surface-alt)}
tr.deleted td{opacity:.5;text-decoration:line-through}

.drawer-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:40;display:flex;justify-content:flex-end}
.drawer{width:min(500px,100vw);height:100vh;background:var(--surface);border-left:1px solid var(--border);padding:20px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}
.toasts{position:fixed;bottom:18px;right:18px;z-index:60;display:flex;flex-direction:column;gap:8px}
.toast{padding:10px 14px;border-radius:9px;background:var(--surface-alt);border:1px solid var(--border);font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.toast.ok{border-color:var(--success);color:var(--success)}
.toast.err{border-color:var(--danger);color:var(--danger)}
.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.split{display:grid;grid-template-columns:280px 1fr;gap:16px}
@media(max-width:860px){.shell{flex-direction:column}.sidebar{width:100%;height:auto;position:static}.split{grid-template-columns:1fr}}
</style>
</head>
<body>
<div id="root"></div>
<div id="toasts" class="toasts"></div>
<script>
const root = document.getElementById('root');
const state = {
  key: sessionStorage.getItem('lls_key') || '',
  authed: false,
  tab: 'overview',
  status: null,
  selectedTable: '',
  includeDeleted: false,
  tableData: null,
  tableOffset: 0,
  tableFilter: '',
  drawer: null, // { mode: 'edit'|'create', table, row }
  fnSelected: '',
  fnArgs: '{}',
  fnResult: null,
  subSource: null,
  subEvents: [],
  logs: [],
  logsTable: '',
  users: [],
  buckets: [],
  selectedBucket: '',
  files: [],
  envVars: [],
  schedules: [],
  settingsInfo: null,
};

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtTime = (ms) => {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? String(ms) : d.toLocaleString();
};

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'err' : type === 'ok' ? 'ok' : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      authorization: 'Bearer ' + state.key,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    state.authed = false;
    sessionStorage.removeItem('lls_key');
    render();
    throw new Error('Invalid SERVER_API_KEY');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
  return data;
}

async function loadStatus() {
  const s = await api('/admin/status');
  state.status = s;
  state.authed = true;
  sessionStorage.setItem('lls_key', state.key);
  const tables = Object.keys(s.tables || {});
  if (!state.selectedTable || !tables.includes(state.selectedTable)) {
    state.selectedTable = tables[0] || '';
  }
  if (!state.fnSelected && s.functions?.length) {
    state.fnSelected = s.functions[0].name;
  }
}

async function loadTable(table = state.selectedTable, offset = 0) {
  if (!table) return;
  state.selectedTable = table;
  state.tableOffset = offset;
  const q = new URLSearchParams({
    limit: '30',
    offset: String(offset),
    includeDeleted: state.includeDeleted ? '1' : '0',
  });
  state.tableData = await api('/admin/tables/' + encodeURIComponent(table) + '?' + q);
  render();
}

async function loadLogs() {
  const q = new URLSearchParams({ limit: '100' });
  if (state.logsTable) q.set('table', state.logsTable);
  const res = await api('/admin/sync-logs?' + q);
  state.logs = res.logs || [];
  render();
}

async function loadUsers() {
  const res = await api('/admin/users');
  state.users = res.users || [];
  render();
}

async function loadStorage() {
  const b = await api('/admin/storage/buckets');
  state.buckets = b.buckets || [];
  if (!state.selectedBucket && state.buckets.length) state.selectedBucket = state.buckets[0].name;
  const f = await api('/admin/storage/files' + (state.selectedBucket ? '?bucket=' + encodeURIComponent(state.selectedBucket) : ''));
  state.files = f.files || [];
  render();
}

async function loadEnv() {
  const res = await api('/admin/env');
  state.envVars = res.vars || [];
  render();
}

async function loadSchedules() {
  const res = await api('/admin/schedules');
  state.schedules = res.schedules || [];
  render();
}

async function loadSettingsInfo() {
  state.settingsInfo = await api('/admin/settings');
  render();
}

function stopSub() {
  if (state.subSource) {
    state.subSource.close();
    state.subSource = null;
  }
}

function renderGate(errMsg = '') {
  root.innerHTML = \`
    <div class="gate">
      <form id="gate-form" class="gate-card">
        <div style="font-size:19px;font-weight:700;margin-bottom:4px">__APP__</div>
        <div class="muted" style="margin-bottom:18px">Enter your <span class="mono">SERVER_API_KEY</span> to open the admin console.</div>
        <label class="label" for="gate-key">API Key</label>
        <input id="gate-key" type="password" class="input" placeholder="SERVER_API_KEY" value="\${esc(state.key)}" autofocus>
        \${errMsg ? \`<div style="color:var(--danger);font-size:12.5px;margin-top:8px">\${esc(errMsg)}</div>\` : ''}
        <button type="submit" class="btn primary" style="width:100%;justify-content:center;margin-top:14px;height:40px">Connect</button>
      </form>
    </div>\`;
  document.getElementById('gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    state.key = document.getElementById('gate-key').value.trim();
    try {
      await loadStatus();
      render();
    } catch (err) {
      renderGate(err.message);
    }
  });
}

function renderOverview() {
  const s = state.status;
  const tables = Object.entries(s.tables || {});
  const totalRows = tables.reduce((sum, [, n]) => sum + Number(n), 0);
  return \`
    <div class="grid">
      <div class="card">
        <div class="label">Database</div>
        <div style="font-size:20px;font-weight:700;color:var(--success)">Connected</div>
        <div class="muted" style="margin-top:4px">\${esc(s.dialect)} · \${esc(s.database)}</div>
      </div>
      <div class="card">
        <div class="label">Total Synced Rows</div>
        <div style="font-size:22px;font-weight:700">\${totalRows.toLocaleString()}</div>
        <div class="muted" style="margin-top:4px">Across \${tables.length} table(s)</div>
      </div>
      <div class="card">
        <div class="label">Sync Cursor</div>
        <div style="font-size:20px;font-weight:700" class="mono">\${s.cursor}</div>
        <div class="muted" style="margin-top:4px">autoMigrate: \${s.autoMigrate ? 'on' : 'off'}</div>
      </div>
      <div class="card">
        <div class="label">Functions &amp; Auth</div>
        <div style="font-size:20px;font-weight:700">\${(s.functions || []).length} fn · \${s.accounts?.users ?? 0} users</div>
        <div class="muted" style="margin-top:4px">accounts: \${s.accounts?.enabled ? 'enabled' : 'disabled'} · smtp: \${s.smtp ? 'on' : 'off'}</div>
      </div>
    </div>
    \${s.schemaPending ? \`<div class="card" style="border-color:var(--warn);margin-bottom:16px"><span class="pill warn">\${s.schemaPending} pending schema change(s)</span> Run <span class="mono">npm run migrate</span> or enable <span class="mono">AUTO_MIGRATE=true</span>.</div>\` : ''}
    \${(s.schemaWarnings || []).map(w => \`<div class="card" style="border-color:var(--warn);margin-bottom:12px">\${esc(w)}</div>\`).join('')}
    <div class="card">
      <div style="font-weight:600;margin-bottom:12px">Synced Tables</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px">
        \${tables.map(([t, n]) => \`
          <button type="button" class="btn" data-open-table="\${esc(t)}" style="justify-content:space-between;padding:12px">
            <span class="mono">\${esc(t)}</span>
            <span class="pill">\${n}</span>
          </button>\`).join('') || '<div class="muted">No tables in schema.ts</div>'}
      </div>
    </div>\`;
}

function renderSchedules() {
  const fns = state.status.functions || [];
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Add / Update Schedule</div>
      <form id="sched-form" style="display:grid;grid-template-columns:1fr 1fr 140px auto;gap:8px;align-items:end">
        <div><label class="label">Name</label><input name="name" class="input" placeholder="daily-cleanup" required></div>
        <div><label class="label">Function</label>
          <select name="fnName" class="select">
            \${fns.map(f => \`<option value="\${esc(f.name)}">\${esc(f.name)} (\${esc(f.kind)})</option>\`).join('') || '<option value="">No functions loaded</option>'}
          </select>
        </div>
        <div><label class="label">Cron</label><input name="cronExpr" class="input mono" value="0 * * * *"></div>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Function</th><th>Cron</th><th>Last Run</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.schedules.map(sc => \`
            <tr>
              <td class="mono">\${esc(sc.name)}</td>
              <td class="mono">\${esc(sc.fn_name)}</td>
              <td class="mono">\${esc(sc.cron_expr)}</td>
              <td>\${fmtTime(sc.last_run_at)}</td>
              <td>\${sc.last_status ? \`<span class="pill \${sc.last_status === 'ok' ? 'ok' : 'err'}">\${esc(sc.last_status)}</span>\` : '—'}</td>
              <td style="display:flex;gap:6px">
                <button type="button" class="btn sm" data-run-sched="\${esc(sc.name)}">Run Now</button>
                <button type="button" class="btn sm danger" data-del-sched="\${esc(sc.name)}">Delete</button>
              </td>
            </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No schedules configured</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderBackups() {
  return \`
    <div class="grid">
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Export Full Backup</div>
        <div class="muted" style="margin-bottom:14px">Downloads all tables from <span class="mono">schema.ts</span> as a portable JSON snapshot.</div>
        <button id="btn-export-backup" type="button" class="btn primary">Download JSON Backup</button>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Restore From Backup</div>
        <div class="muted" style="margin-bottom:10px">Select a previously exported <span class="mono">.json</span> backup file to upsert rows and notify sync clients.</div>
        <input id="backup-file" type="file" accept=".json,application/json" class="input" style="margin-bottom:10px">
        <button id="btn-restore-backup" type="button" class="btn">Restore Selected File</button>
      </div>
    </div>\`;
}

function renderStorage() {
  return \`
    <div class="split">
      <div class="card" style="align-self:start">
        <div style="font-weight:600;margin-bottom:10px">Buckets</div>
        <form id="bucket-form" style="display:flex;gap:6px;margin-bottom:10px">
          <input name="name" class="input" placeholder="bucket-name" required>
          <button type="submit" class="btn primary sm">+</button>
        </form>
        <div style="display:flex;flex-direction:column;gap:4px">
          \${state.buckets.map(b => \`
            <div style="display:flex;gap:4px;align-items:center">
              <button type="button" class="nav-item \${state.selectedBucket === b.name ? 'active' : ''}" data-pick-bucket="\${esc(b.name)}" style="flex:1">
                <span class="mono">\${esc(b.name)}</span>
                <span class="pill">\${esc(b.visibility)}</span>
              </button>
              <button type="button" class="btn sm danger" data-del-bucket="\${esc(b.name)}">×</button>
            </div>\`).join('') || '<div class="muted">No buckets yet</div>'}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <strong class="mono">\${esc(state.selectedBucket || 'All buckets')}</strong>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="storage-file-input" type="file" class="input" style="max-width:240px" \${state.selectedBucket ? '' : 'disabled'}>
            <button id="btn-upload-file" type="button" class="btn primary sm" \${state.selectedBucket ? '' : 'disabled'}>Upload</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Bucket</th><th>MIME</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              \${state.files.map(f => \`
                <tr>
                  <td>\${esc(f.name)}</td>
                  <td class="mono">\${esc(f.bucket)}</td>
                  <td class="mono">\${esc(f.mime_type)}</td>
                  <td>\${Number(f.size_bytes).toLocaleString()} B</td>
                  <td>\${fmtTime(f.created_at)}</td>
                  <td><button type="button" class="btn sm danger" data-del-file="\${esc(f.id)}">Delete</button></td>
                </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No files</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>\`;
}

function renderEnv() {
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Set Environment Variable</div>
      <form id="env-form" style="display:grid;grid-template-columns:1fr 1.5fr auto auto;gap:8px;align-items:end">
        <div><label class="label">Key</label><input name="key" class="input mono" placeholder="MY_API_KEY" required></div>
        <div><label class="label">Value</label><input name="value" class="input" placeholder="value"></div>
        <label style="display:inline-flex;align-items:center;gap:6px;padding-bottom:8px;font-size:12.5px"><input name="isSecret" type="checkbox"> Secret</label>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.envVars.map(v => \`
            <tr>
              <td class="mono">\${esc(v.key)}</td>
              <td class="mono">\${esc(v.value)}</td>
              <td>\${fmtTime(v.updatedAt)}</td>
              <td><button type="button" class="btn sm danger" data-del-env="\${esc(v.key)}">Delete</button></td>
            </tr>\`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">No DB environment variables stored</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderSettings() {
  const info = state.settingsInfo;
  if (!info) return '<div class="card muted">Loading...</div>';
  return \`
    <div class="grid">
      <div class="card">
        <div class="label">Database Connection</div>
        <div class="mono">\${esc(info.dialect)} · \${esc(info.host)}:\${info.port}/\${esc(info.database)}</div>
        <div class="muted" style="margin-top:4px">Pool size: \${info.poolSize} · Auto-migrate: \${info.autoMigrate ? 'true' : 'false'}</div>
      </div>
      <div class="card">
        <div class="label">HTTP &amp; Storage</div>
        <div class="mono">CORS: \${esc((info.corsOrigins || []).join(', '))}</div>
        <div class="muted" style="margin-top:4px">Uploads: \${esc(info.uploadDir)} · SMTP: \${info.smtp ? esc(info.smtp.host) : 'not configured'}</div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>Pending Schema SQL (\${(info.pendingSql || []).length})</strong>
        \${(info.pendingSql || []).length ? '<button id="btn-apply-schema" type="button" class="btn primary sm">Apply Migrations Now</button>' : '<span class="pill ok">Up to date</span>'}
      </div>
      \${(info.pendingSql || []).length ? \`<pre class="card mono" style="background:var(--bg);overflow:auto;font-size:12px">\${esc(info.pendingSql.join('\\n\\n'))}</pre>\` : '<div class="muted">All tables and columns from schema.ts are applied.</div>'}
    </div>\`;
}

function renderData() {
  const s = state.status;
  const tables = Object.entries(s.tables || {}).filter(([t]) =>
    !state.tableFilter || t.toLowerCase().includes(state.tableFilter.toLowerCase())
  );
  const d = state.tableData;
  const cols = d?.columns || [];
  const rows = d?.rows || [];
  return \`
    <div class="split">
      <div class="card" style="align-self:start">
        <input id="tbl-filter" class="input" placeholder="Filter tables..." value="\${esc(state.tableFilter)}" style="margin-bottom:10px">
        <div style="display:flex;flex-direction:column;gap:4px">
          \${tables.map(([t, n]) => \`
            <button type="button" class="nav-item \${state.selectedTable === t ? 'active' : ''}" data-pick-table="\${esc(t)}">
              <span class="mono" style="flex:1">\${esc(t)}</span>
              <span class="pill">\${n}</span>
            </button>\`).join('')}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:10px">
            <strong class="mono" style="font-size:15px">\${esc(state.selectedTable || '—')}</strong>
            \${d ? \`<span class="pill">\${d.total ?? rows.length} rows</span>\` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);cursor:pointer">
              <input id="chk-deleted" type="checkbox" \${state.includeDeleted ? 'checked' : ''}> Show deleted
            </label>
            <button id="btn-new-row" type="button" class="btn primary sm" \${state.selectedTable ? '' : 'disabled'}>+ New Row</button>
            <button id="btn-reload-tbl" type="button" class="btn sm">Refresh</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>\${cols.map(c => \`<th>\${esc(c)}</th>\`).join('')}</tr></thead>
            <tbody>
              \${rows.map((r, i) => \`
                <tr class="clickable \${r.deleted ? 'deleted' : ''}" data-row-idx="\${i}">
                  \${cols.map(c => {
                    const v = r[c];
                    const txt = v === null || v === undefined ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                    return \`<td title="\${esc(txt)}">\${v === null || v === undefined ? '<span class="muted">null</span>' : esc(txt)}</td>\`;
                  }).join('')}
                </tr>\`).join('') || \`<tr><td colspan="\${Math.max(cols.length,1)}" class="muted" style="text-align:center;padding:24px">No rows</td></tr>\`}
            </tbody>
          </table>
        </div>
        \${d ? \`
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
            <span class="muted">Showing \${rows.length ? state.tableOffset + 1 : 0}–\${state.tableOffset + rows.length} of \${d.total ?? rows.length}</span>
            <div style="display:flex;gap:8px">
              <button id="btn-prev" class="btn sm" \${state.tableOffset <= 0 ? 'disabled' : ''}>Prev</button>
              <button id="btn-next" class="btn sm" \${state.tableOffset + rows.length >= (d.total ?? 0) ? 'disabled' : ''}>Next</button>
            </div>
          </div>\` : ''}
      </div>
    </div>\`;
}

function renderSchedules() {
  const fns = state.status.functions || [];
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Add / Update Schedule</div>
      <form id="sched-form" style="display:grid;grid-template-columns:1fr 1fr 140px auto;gap:8px;align-items:end">
        <div><label class="label">Name</label><input name="name" class="input" placeholder="daily-cleanup" required></div>
        <div><label class="label">Function</label>
          <select name="fnName" class="select">
            \${fns.map(f => \`<option value="\${esc(f.name)}">\${esc(f.name)} (\${esc(f.kind)})</option>\`).join('') || '<option value="">No functions loaded</option>'}
          </select>
        </div>
        <div><label class="label">Cron</label><input name="cronExpr" class="input mono" value="0 * * * *"></div>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Function</th><th>Cron</th><th>Last Run</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.schedules.map(sc => \`
            <tr>
              <td class="mono">\${esc(sc.name)}</td>
              <td class="mono">\${esc(sc.fn_name)}</td>
              <td class="mono">\${esc(sc.cron_expr)}</td>
              <td>\${fmtTime(sc.last_run_at)}</td>
              <td>\${sc.last_status ? \`<span class="pill \${sc.last_status === 'ok' ? 'ok' : 'err'}">\${esc(sc.last_status)}</span>\` : '—'}</td>
              <td style="display:flex;gap:6px">
                <button type="button" class="btn sm" data-run-sched="\${esc(sc.name)}">Run Now</button>
                <button type="button" class="btn sm danger" data-del-sched="\${esc(sc.name)}">Delete</button>
              </td>
            </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No schedules configured</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderBackups() {
  return \`
    <div class="grid">
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Export Full Backup</div>
        <div class="muted" style="margin-bottom:14px">Downloads all tables from <span class="mono">schema.ts</span> as a portable JSON snapshot.</div>
        <button id="btn-export-backup" type="button" class="btn primary">Download JSON Backup</button>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Restore From Backup</div>
        <div class="muted" style="margin-bottom:10px">Select a previously exported <span class="mono">.json</span> backup file to upsert rows and notify sync clients.</div>
        <input id="backup-file" type="file" accept=".json,application/json" class="input" style="margin-bottom:10px">
        <button id="btn-restore-backup" type="button" class="btn">Restore Selected File</button>
      </div>
    </div>\`;
}

function renderStorage() {
  return \`
    <div class="split">
      <div class="card" style="align-self:start">
        <div style="font-weight:600;margin-bottom:10px">Buckets</div>
        <form id="bucket-form" style="display:flex;gap:6px;margin-bottom:10px">
          <input name="name" class="input" placeholder="bucket-name" required>
          <button type="submit" class="btn primary sm">+</button>
        </form>
        <div style="display:flex;flex-direction:column;gap:4px">
          \${state.buckets.map(b => \`
            <div style="display:flex;gap:4px;align-items:center">
              <button type="button" class="nav-item \${state.selectedBucket === b.name ? 'active' : ''}" data-pick-bucket="\${esc(b.name)}" style="flex:1">
                <span class="mono">\${esc(b.name)}</span>
                <span class="pill">\${esc(b.visibility)}</span>
              </button>
              <button type="button" class="btn sm danger" data-del-bucket="\${esc(b.name)}">×</button>
            </div>\`).join('') || '<div class="muted">No buckets yet</div>'}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <strong class="mono">\${esc(state.selectedBucket || 'All buckets')}</strong>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="storage-file-input" type="file" class="input" style="max-width:240px" \${state.selectedBucket ? '' : 'disabled'}>
            <button id="btn-upload-file" type="button" class="btn primary sm" \${state.selectedBucket ? '' : 'disabled'}>Upload</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Bucket</th><th>MIME</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              \${state.files.map(f => \`
                <tr>
                  <td>\${esc(f.name)}</td>
                  <td class="mono">\${esc(f.bucket)}</td>
                  <td class="mono">\${esc(f.mime_type)}</td>
                  <td>\${Number(f.size_bytes).toLocaleString()} B</td>
                  <td>\${fmtTime(f.created_at)}</td>
                  <td><button type="button" class="btn sm danger" data-del-file="\${esc(f.id)}">Delete</button></td>
                </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No files</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>\`;
}

function renderEnv() {
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Set Environment Variable</div>
      <form id="env-form" style="display:grid;grid-template-columns:1fr 1.5fr auto auto;gap:8px;align-items:end">
        <div><label class="label">Key</label><input name="key" class="input mono" placeholder="MY_API_KEY" required></div>
        <div><label class="label">Value</label><input name="value" class="input" placeholder="value"></div>
        <label style="display:inline-flex;align-items:center;gap:6px;padding-bottom:8px;font-size:12.5px"><input name="isSecret" type="checkbox"> Secret</label>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.envVars.map(v => \`
            <tr>
              <td class="mono">\${esc(v.key)}</td>
              <td class="mono">\${esc(v.value)}</td>
              <td>\${fmtTime(v.updatedAt)}</td>
              <td><button type="button" class="btn sm danger" data-del-env="\${esc(v.key)}">Delete</button></td>
            </tr>\`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">No DB environment variables stored</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderSettings() {
  const info = state.settingsInfo;
  if (!info) return '<div class="card muted">Loading...</div>';
  return \`
    <div class="grid">
      <div class="card">
        <div class="label">Database Connection</div>
        <div class="mono">\${esc(info.dialect)} · \${esc(info.host)}:\${info.port}/\${esc(info.database)}</div>
        <div class="muted" style="margin-top:4px">Pool size: \${info.poolSize} · Auto-migrate: \${info.autoMigrate ? 'true' : 'false'}</div>
      </div>
      <div class="card">
        <div class="label">HTTP &amp; Storage</div>
        <div class="mono">CORS: \${esc((info.corsOrigins || []).join(', '))}</div>
        <div class="muted" style="margin-top:4px">Uploads: \${esc(info.uploadDir)} · SMTP: \${info.smtp ? esc(info.smtp.host) : 'not configured'}</div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>Pending Schema SQL (\${(info.pendingSql || []).length})</strong>
        \${(info.pendingSql || []).length ? '<button id="btn-apply-schema" type="button" class="btn primary sm">Apply Migrations Now</button>' : '<span class="pill ok">Up to date</span>'}
      </div>
      \${(info.pendingSql || []).length ? \`<pre class="card mono" style="background:var(--bg);overflow:auto;font-size:12px">\${esc(info.pendingSql.join('\\n\\n'))}</pre>\` : '<div class="muted">All tables and columns from schema.ts are applied.</div>'}
    </div>\`;
}

function renderFunctions() {
  const fns = state.status.functions || [];
  const current = fns.find(f => f.name === state.fnSelected) || fns[0];
  return \`
    <div class="split">
      <div class="card" style="align-self:start">
        <div style="font-weight:600;margin-bottom:10px">Functions (\${fns.length})</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          \${fns.map(f => \`
            <button type="button" class="nav-item \${state.fnSelected === f.name ? 'active' : ''}" data-pick-fn="\${esc(f.name)}">
              <span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis">\${esc(f.name)}</span>
              <span class="pill accent">\${esc(f.kind)}</span>
            </button>\`).join('') || '<div class="muted">No functions loaded from functions/</div>'}
        </div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div class="mono" style="font-size:15px;font-weight:600">\${esc(current?.name || 'Select a function')}</div>
            <div class="muted">POST /fn/\${esc(current?.name || '...')}</div>
          </div>
          \${current ? \`<span class="pill accent">\${esc(current.kind)}</span>\` : ''}
        </div>
        <label class="label">Arguments (JSON)</label>
        <textarea id="fn-args" class="textarea">\${esc(state.fnArgs)}</textarea>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button id="btn-run-fn" type="button" class="btn primary" \${current ? '' : 'disabled'}>Run Function</button>
          \${current?.kind === 'query' ? \`
            <button id="btn-sub-fn" type="button" class="btn">\${state.subSource ? 'Stop Subscribe' : 'Subscribe (SSE)'}</button>
          \` : ''}
        </div>
        \${state.fnResult ? \`
          <div style="margin-top:16px">
            <div class="label">Result (\${esc(state.fnResult.status)})</div>
            <pre class="card mono" style="background:var(--bg);overflow:auto;max-height:320px;font-size:12px;margin:0">\${esc(state.fnResult.body)}</pre>
          </div>\` : ''}
        \${state.subEvents.length ? \`
          <div style="margin-top:16px">
            <div class="label">Live SSE Updates (\${state.subEvents.length})</div>
            <pre class="card mono" style="background:var(--bg);overflow:auto;max-height:260px;font-size:12px;margin:0">\${esc(state.subEvents.join('\\n---\\n'))}</pre>
          </div>\` : ''}
      </div>
    </div>\`;
}

function renderSchedules() {
  const fns = state.status.functions || [];
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Add / Update Schedule</div>
      <form id="sched-form" style="display:grid;grid-template-columns:1fr 1fr 140px auto;gap:8px;align-items:end">
        <div><label class="label">Name</label><input name="name" class="input" placeholder="daily-cleanup" required></div>
        <div><label class="label">Function</label>
          <select name="fnName" class="select">
            \${fns.map(f => \`<option value="\${esc(f.name)}">\${esc(f.name)} (\${esc(f.kind)})</option>\`).join('') || '<option value="">No functions loaded</option>'}
          </select>
        </div>
        <div><label class="label">Cron</label><input name="cronExpr" class="input mono" value="0 * * * *"></div>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Function</th><th>Cron</th><th>Last Run</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.schedules.map(sc => \`
            <tr>
              <td class="mono">\${esc(sc.name)}</td>
              <td class="mono">\${esc(sc.fn_name)}</td>
              <td class="mono">\${esc(sc.cron_expr)}</td>
              <td>\${fmtTime(sc.last_run_at)}</td>
              <td>\${sc.last_status ? \`<span class="pill \${sc.last_status === 'ok' ? 'ok' : 'err'}">\${esc(sc.last_status)}</span>\` : '—'}</td>
              <td style="display:flex;gap:6px">
                <button type="button" class="btn sm" data-run-sched="\${esc(sc.name)}">Run Now</button>
                <button type="button" class="btn sm danger" data-del-sched="\${esc(sc.name)}">Delete</button>
              </td>
            </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No schedules configured</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderBackups() {
  return \`
    <div class="grid">
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Export Full Backup</div>
        <div class="muted" style="margin-bottom:14px">Downloads all tables from <span class="mono">schema.ts</span> as a portable JSON snapshot.</div>
        <button id="btn-export-backup" type="button" class="btn primary">Download JSON Backup</button>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Restore From Backup</div>
        <div class="muted" style="margin-bottom:10px">Select a previously exported <span class="mono">.json</span> backup file to upsert rows and notify sync clients.</div>
        <input id="backup-file" type="file" accept=".json,application/json" class="input" style="margin-bottom:10px">
        <button id="btn-restore-backup" type="button" class="btn">Restore Selected File</button>
      </div>
    </div>\`;
}

function renderStorage() {
  return \`
    <div class="split">
      <div class="card" style="align-self:start">
        <div style="font-weight:600;margin-bottom:10px">Buckets</div>
        <form id="bucket-form" style="display:flex;gap:6px;margin-bottom:10px">
          <input name="name" class="input" placeholder="bucket-name" required>
          <button type="submit" class="btn primary sm">+</button>
        </form>
        <div style="display:flex;flex-direction:column;gap:4px">
          \${state.buckets.map(b => \`
            <div style="display:flex;gap:4px;align-items:center">
              <button type="button" class="nav-item \${state.selectedBucket === b.name ? 'active' : ''}" data-pick-bucket="\${esc(b.name)}" style="flex:1">
                <span class="mono">\${esc(b.name)}</span>
                <span class="pill">\${esc(b.visibility)}</span>
              </button>
              <button type="button" class="btn sm danger" data-del-bucket="\${esc(b.name)}">×</button>
            </div>\`).join('') || '<div class="muted">No buckets yet</div>'}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <strong class="mono">\${esc(state.selectedBucket || 'All buckets')}</strong>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="storage-file-input" type="file" class="input" style="max-width:240px" \${state.selectedBucket ? '' : 'disabled'}>
            <button id="btn-upload-file" type="button" class="btn primary sm" \${state.selectedBucket ? '' : 'disabled'}>Upload</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Bucket</th><th>MIME</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              \${state.files.map(f => \`
                <tr>
                  <td>\${esc(f.name)}</td>
                  <td class="mono">\${esc(f.bucket)}</td>
                  <td class="mono">\${esc(f.mime_type)}</td>
                  <td>\${Number(f.size_bytes).toLocaleString()} B</td>
                  <td>\${fmtTime(f.created_at)}</td>
                  <td><button type="button" class="btn sm danger" data-del-file="\${esc(f.id)}">Delete</button></td>
                </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No files</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>\`;
}

function renderEnv() {
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Set Environment Variable</div>
      <form id="env-form" style="display:grid;grid-template-columns:1fr 1.5fr auto auto;gap:8px;align-items:end">
        <div><label class="label">Key</label><input name="key" class="input mono" placeholder="MY_API_KEY" required></div>
        <div><label class="label">Value</label><input name="value" class="input" placeholder="value"></div>
        <label style="display:inline-flex;align-items:center;gap:6px;padding-bottom:8px;font-size:12.5px"><input name="isSecret" type="checkbox"> Secret</label>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.envVars.map(v => \`
            <tr>
              <td class="mono">\${esc(v.key)}</td>
              <td class="mono">\${esc(v.value)}</td>
              <td>\${fmtTime(v.updatedAt)}</td>
              <td><button type="button" class="btn sm danger" data-del-env="\${esc(v.key)}">Delete</button></td>
            </tr>\`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">No DB environment variables stored</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderSettings() {
  const info = state.settingsInfo;
  if (!info) return '<div class="card muted">Loading...</div>';
  return \`
    <div class="grid">
      <div class="card">
        <div class="label">Database Connection</div>
        <div class="mono">\${esc(info.dialect)} · \${esc(info.host)}:\${info.port}/\${esc(info.database)}</div>
        <div class="muted" style="margin-top:4px">Pool size: \${info.poolSize} · Auto-migrate: \${info.autoMigrate ? 'true' : 'false'}</div>
      </div>
      <div class="card">
        <div class="label">HTTP &amp; Storage</div>
        <div class="mono">CORS: \${esc((info.corsOrigins || []).join(', '))}</div>
        <div class="muted" style="margin-top:4px">Uploads: \${esc(info.uploadDir)} · SMTP: \${info.smtp ? esc(info.smtp.host) : 'not configured'}</div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>Pending Schema SQL (\${(info.pendingSql || []).length})</strong>
        \${(info.pendingSql || []).length ? '<button id="btn-apply-schema" type="button" class="btn primary sm">Apply Migrations Now</button>' : '<span class="pill ok">Up to date</span>'}
      </div>
      \${(info.pendingSql || []).length ? \`<pre class="card mono" style="background:var(--bg);overflow:auto;font-size:12px">\${esc(info.pendingSql.join('\\n\\n'))}</pre>\` : '<div class="muted">All tables and columns from schema.ts are applied.</div>'}
    </div>\`;
}

function renderLogs() {
  return \`
    <div class="card" style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="log-table" class="select" style="max-width:220px">
        <option value="">All tables</option>
        \${Object.keys(state.status.tables || {}).map(t => \`<option value="\${esc(t)}" \${state.logsTable === t ? 'selected' : ''}>\${esc(t)}</option>\`).join('')}
      </select>
      <button id="btn-refresh-logs" class="btn sm">Refresh</button>
      <span class="muted">Showing latest \${state.logs.length} entries from <span class="mono">_server_changes</span></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Table</th><th>Row ID</th><th>Timestamp</th></tr></thead>
        <tbody>
          \${state.logs.map(l => \`
            <tr>
              <td class="mono">\${l.id}</td>
              <td class="mono">\${esc(l.table_name)}</td>
              <td class="mono">\${esc(l.row_id)}</td>
              <td>\${fmtTime(l.timestamp)} <span class="muted mono">(\${l.timestamp})</span></td>
            </tr>\`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">No sync events yet</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderSchedules() {
  const fns = state.status.functions || [];
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Add / Update Schedule</div>
      <form id="sched-form" style="display:grid;grid-template-columns:1fr 1fr 140px auto;gap:8px;align-items:end">
        <div><label class="label">Name</label><input name="name" class="input" placeholder="daily-cleanup" required></div>
        <div><label class="label">Function</label>
          <select name="fnName" class="select">
            \${fns.map(f => \`<option value="\${esc(f.name)}">\${esc(f.name)} (\${esc(f.kind)})</option>\`).join('') || '<option value="">No functions loaded</option>'}
          </select>
        </div>
        <div><label class="label">Cron</label><input name="cronExpr" class="input mono" value="0 * * * *"></div>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Function</th><th>Cron</th><th>Last Run</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.schedules.map(sc => \`
            <tr>
              <td class="mono">\${esc(sc.name)}</td>
              <td class="mono">\${esc(sc.fn_name)}</td>
              <td class="mono">\${esc(sc.cron_expr)}</td>
              <td>\${fmtTime(sc.last_run_at)}</td>
              <td>\${sc.last_status ? \`<span class="pill \${sc.last_status === 'ok' ? 'ok' : 'err'}">\${esc(sc.last_status)}</span>\` : '—'}</td>
              <td style="display:flex;gap:6px">
                <button type="button" class="btn sm" data-run-sched="\${esc(sc.name)}">Run Now</button>
                <button type="button" class="btn sm danger" data-del-sched="\${esc(sc.name)}">Delete</button>
              </td>
            </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No schedules configured</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderBackups() {
  return \`
    <div class="grid">
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Export Full Backup</div>
        <div class="muted" style="margin-bottom:14px">Downloads all tables from <span class="mono">schema.ts</span> as a portable JSON snapshot.</div>
        <button id="btn-export-backup" type="button" class="btn primary">Download JSON Backup</button>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Restore From Backup</div>
        <div class="muted" style="margin-bottom:10px">Select a previously exported <span class="mono">.json</span> backup file to upsert rows and notify sync clients.</div>
        <input id="backup-file" type="file" accept=".json,application/json" class="input" style="margin-bottom:10px">
        <button id="btn-restore-backup" type="button" class="btn">Restore Selected File</button>
      </div>
    </div>\`;
}

function renderStorage() {
  return \`
    <div class="split">
      <div class="card" style="align-self:start">
        <div style="font-weight:600;margin-bottom:10px">Buckets</div>
        <form id="bucket-form" style="display:flex;gap:6px;margin-bottom:10px">
          <input name="name" class="input" placeholder="bucket-name" required>
          <button type="submit" class="btn primary sm">+</button>
        </form>
        <div style="display:flex;flex-direction:column;gap:4px">
          \${state.buckets.map(b => \`
            <div style="display:flex;gap:4px;align-items:center">
              <button type="button" class="nav-item \${state.selectedBucket === b.name ? 'active' : ''}" data-pick-bucket="\${esc(b.name)}" style="flex:1">
                <span class="mono">\${esc(b.name)}</span>
                <span class="pill">\${esc(b.visibility)}</span>
              </button>
              <button type="button" class="btn sm danger" data-del-bucket="\${esc(b.name)}">×</button>
            </div>\`).join('') || '<div class="muted">No buckets yet</div>'}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <strong class="mono">\${esc(state.selectedBucket || 'All buckets')}</strong>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="storage-file-input" type="file" class="input" style="max-width:240px" \${state.selectedBucket ? '' : 'disabled'}>
            <button id="btn-upload-file" type="button" class="btn primary sm" \${state.selectedBucket ? '' : 'disabled'}>Upload</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Bucket</th><th>MIME</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              \${state.files.map(f => \`
                <tr>
                  <td>\${esc(f.name)}</td>
                  <td class="mono">\${esc(f.bucket)}</td>
                  <td class="mono">\${esc(f.mime_type)}</td>
                  <td>\${Number(f.size_bytes).toLocaleString()} B</td>
                  <td>\${fmtTime(f.created_at)}</td>
                  <td><button type="button" class="btn sm danger" data-del-file="\${esc(f.id)}">Delete</button></td>
                </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No files</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>\`;
}

function renderEnv() {
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Set Environment Variable</div>
      <form id="env-form" style="display:grid;grid-template-columns:1fr 1.5fr auto auto;gap:8px;align-items:end">
        <div><label class="label">Key</label><input name="key" class="input mono" placeholder="MY_API_KEY" required></div>
        <div><label class="label">Value</label><input name="value" class="input" placeholder="value"></div>
        <label style="display:inline-flex;align-items:center;gap:6px;padding-bottom:8px;font-size:12.5px"><input name="isSecret" type="checkbox"> Secret</label>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.envVars.map(v => \`
            <tr>
              <td class="mono">\${esc(v.key)}</td>
              <td class="mono">\${esc(v.value)}</td>
              <td>\${fmtTime(v.updatedAt)}</td>
              <td><button type="button" class="btn sm danger" data-del-env="\${esc(v.key)}">Delete</button></td>
            </tr>\`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">No DB environment variables stored</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderSettings() {
  const info = state.settingsInfo;
  if (!info) return '<div class="card muted">Loading...</div>';
  return \`
    <div class="grid">
      <div class="card">
        <div class="label">Database Connection</div>
        <div class="mono">\${esc(info.dialect)} · \${esc(info.host)}:\${info.port}/\${esc(info.database)}</div>
        <div class="muted" style="margin-top:4px">Pool size: \${info.poolSize} · Auto-migrate: \${info.autoMigrate ? 'true' : 'false'}</div>
      </div>
      <div class="card">
        <div class="label">HTTP &amp; Storage</div>
        <div class="mono">CORS: \${esc((info.corsOrigins || []).join(', '))}</div>
        <div class="muted" style="margin-top:4px">Uploads: \${esc(info.uploadDir)} · SMTP: \${info.smtp ? esc(info.smtp.host) : 'not configured'}</div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>Pending Schema SQL (\${(info.pendingSql || []).length})</strong>
        \${(info.pendingSql || []).length ? '<button id="btn-apply-schema" type="button" class="btn primary sm">Apply Migrations Now</button>' : '<span class="pill ok">Up to date</span>'}
      </div>
      \${(info.pendingSql || []).length ? \`<pre class="card mono" style="background:var(--bg);overflow:auto;font-size:12px">\${esc(info.pendingSql.join('\\n\\n'))}</pre>\` : '<div class="muted">All tables and columns from schema.ts are applied.</div>'}
    </div>\`;
}

function renderUsers() {
  if (!state.status.accounts?.enabled) {
    return \`<div class="card"><div style="font-weight:600;margin-bottom:6px">Accounts Disabled</div><div class="muted">Set <span class="mono">APP_SECRET</span> in your environment and restart to enable <span class="mono">/auth/*</span> user accounts.</div></div>\`;
  }
  return \`
    <div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <span><strong>\${state.users.length}</strong> registered account(s)</span>
      <button id="btn-refresh-users" class="btn sm">Refresh</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>Token v</th><th>Failed Logins</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.users.map(u => \`
            <tr>
              <td>\${esc(u.email)}</td>
              <td>\${esc(u.display_name || '—')}</td>
              <td class="mono">\${u.token_version ?? 1}</td>
              <td>\${u.failed_login_attempts ?? 0}</td>
              <td>\${fmtTime(u.created_at)}</td>
              <td><button type="button" class="btn sm" data-revoke-user="\${esc(u.id)}">Revoke &amp; Unlock</button></td>
            </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No users yet</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderSchedules() {
  const fns = state.status.functions || [];
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Add / Update Schedule</div>
      <form id="sched-form" style="display:grid;grid-template-columns:1fr 1fr 140px auto;gap:8px;align-items:end">
        <div><label class="label">Name</label><input name="name" class="input" placeholder="daily-cleanup" required></div>
        <div><label class="label">Function</label>
          <select name="fnName" class="select">
            \${fns.map(f => \`<option value="\${esc(f.name)}">\${esc(f.name)} (\${esc(f.kind)})</option>\`).join('') || '<option value="">No functions loaded</option>'}
          </select>
        </div>
        <div><label class="label">Cron</label><input name="cronExpr" class="input mono" value="0 * * * *"></div>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Function</th><th>Cron</th><th>Last Run</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.schedules.map(sc => \`
            <tr>
              <td class="mono">\${esc(sc.name)}</td>
              <td class="mono">\${esc(sc.fn_name)}</td>
              <td class="mono">\${esc(sc.cron_expr)}</td>
              <td>\${fmtTime(sc.last_run_at)}</td>
              <td>\${sc.last_status ? \`<span class="pill \${sc.last_status === 'ok' ? 'ok' : 'err'}">\${esc(sc.last_status)}</span>\` : '—'}</td>
              <td style="display:flex;gap:6px">
                <button type="button" class="btn sm" data-run-sched="\${esc(sc.name)}">Run Now</button>
                <button type="button" class="btn sm danger" data-del-sched="\${esc(sc.name)}">Delete</button>
              </td>
            </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No schedules configured</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderBackups() {
  return \`
    <div class="grid">
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Export Full Backup</div>
        <div class="muted" style="margin-bottom:14px">Downloads all tables from <span class="mono">schema.ts</span> as a portable JSON snapshot.</div>
        <button id="btn-export-backup" type="button" class="btn primary">Download JSON Backup</button>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Restore From Backup</div>
        <div class="muted" style="margin-bottom:10px">Select a previously exported <span class="mono">.json</span> backup file to upsert rows and notify sync clients.</div>
        <input id="backup-file" type="file" accept=".json,application/json" class="input" style="margin-bottom:10px">
        <button id="btn-restore-backup" type="button" class="btn">Restore Selected File</button>
      </div>
    </div>\`;
}

function renderStorage() {
  return \`
    <div class="split">
      <div class="card" style="align-self:start">
        <div style="font-weight:600;margin-bottom:10px">Buckets</div>
        <form id="bucket-form" style="display:flex;gap:6px;margin-bottom:10px">
          <input name="name" class="input" placeholder="bucket-name" required>
          <button type="submit" class="btn primary sm">+</button>
        </form>
        <div style="display:flex;flex-direction:column;gap:4px">
          \${state.buckets.map(b => \`
            <div style="display:flex;gap:4px;align-items:center">
              <button type="button" class="nav-item \${state.selectedBucket === b.name ? 'active' : ''}" data-pick-bucket="\${esc(b.name)}" style="flex:1">
                <span class="mono">\${esc(b.name)}</span>
                <span class="pill">\${esc(b.visibility)}</span>
              </button>
              <button type="button" class="btn sm danger" data-del-bucket="\${esc(b.name)}">×</button>
            </div>\`).join('') || '<div class="muted">No buckets yet</div>'}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <strong class="mono">\${esc(state.selectedBucket || 'All buckets')}</strong>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="storage-file-input" type="file" class="input" style="max-width:240px" \${state.selectedBucket ? '' : 'disabled'}>
            <button id="btn-upload-file" type="button" class="btn primary sm" \${state.selectedBucket ? '' : 'disabled'}>Upload</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Bucket</th><th>MIME</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              \${state.files.map(f => \`
                <tr>
                  <td>\${esc(f.name)}</td>
                  <td class="mono">\${esc(f.bucket)}</td>
                  <td class="mono">\${esc(f.mime_type)}</td>
                  <td>\${Number(f.size_bytes).toLocaleString()} B</td>
                  <td>\${fmtTime(f.created_at)}</td>
                  <td><button type="button" class="btn sm danger" data-del-file="\${esc(f.id)}">Delete</button></td>
                </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No files</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>\`;
}

function renderEnv() {
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Set Environment Variable</div>
      <form id="env-form" style="display:grid;grid-template-columns:1fr 1.5fr auto auto;gap:8px;align-items:end">
        <div><label class="label">Key</label><input name="key" class="input mono" placeholder="MY_API_KEY" required></div>
        <div><label class="label">Value</label><input name="value" class="input" placeholder="value"></div>
        <label style="display:inline-flex;align-items:center;gap:6px;padding-bottom:8px;font-size:12.5px"><input name="isSecret" type="checkbox"> Secret</label>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.envVars.map(v => \`
            <tr>
              <td class="mono">\${esc(v.key)}</td>
              <td class="mono">\${esc(v.value)}</td>
              <td>\${fmtTime(v.updatedAt)}</td>
              <td><button type="button" class="btn sm danger" data-del-env="\${esc(v.key)}">Delete</button></td>
            </tr>\`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">No DB environment variables stored</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderSettings() {
  const info = state.settingsInfo;
  if (!info) return '<div class="card muted">Loading...</div>';
  return \`
    <div class="grid">
      <div class="card">
        <div class="label">Database Connection</div>
        <div class="mono">\${esc(info.dialect)} · \${esc(info.host)}:\${info.port}/\${esc(info.database)}</div>
        <div class="muted" style="margin-top:4px">Pool size: \${info.poolSize} · Auto-migrate: \${info.autoMigrate ? 'true' : 'false'}</div>
      </div>
      <div class="card">
        <div class="label">HTTP &amp; Storage</div>
        <div class="mono">CORS: \${esc((info.corsOrigins || []).join(', '))}</div>
        <div class="muted" style="margin-top:4px">Uploads: \${esc(info.uploadDir)} · SMTP: \${info.smtp ? esc(info.smtp.host) : 'not configured'}</div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>Pending Schema SQL (\${(info.pendingSql || []).length})</strong>
        \${(info.pendingSql || []).length ? '<button id="btn-apply-schema" type="button" class="btn primary sm">Apply Migrations Now</button>' : '<span class="pill ok">Up to date</span>'}
      </div>
      \${(info.pendingSql || []).length ? \`<pre class="card mono" style="background:var(--bg);overflow:auto;font-size:12px">\${esc(info.pendingSql.join('\\n\\n'))}</pre>\` : '<div class="muted">All tables and columns from schema.ts are applied.</div>'}
    </div>\`;
}

function renderDrawer() {
  if (!state.drawer) return '';
  const { mode, table, row } = state.drawer;
  const schemaCols = state.status.schema?.[table] || {};
  const editableCols = Object.keys(schemaCols).filter(c => !['id', 'updated_at', 'deleted'].includes(c));
  return \`
    <div id="drawer-bg" class="drawer-backdrop">
      <form id="drawer-form" class="drawer">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong class="mono">\${mode === 'create' ? 'New row in ' + esc(table) : esc(table) + ' / ' + esc(row.id)}</strong>
          <button id="drawer-close" type="button" class="btn sm">Close</button>
        </div>
        \${mode === 'create' ? \`
          <div>
            <label class="label">id (leave blank to auto-generate)</label>
            <input name="id" class="input mono" placeholder="uuid">
          </div>\` : \`
          <div class="muted mono">updated_at: \${row.updated_at} · deleted: \${Boolean(row.deleted)}</div>\`}
        \${editableCols.map(c => {
          const type = schemaCols[c];
          const val = row?.[c];
          const strVal = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
          if (type.startsWith('boolean')) {
            return \`<div><label class="label">\${esc(c)} <span class="muted">(\${esc(type)})</span></label>
              <select name="\${esc(c)}" class="select">
                <option value="false" \${!val ? 'selected' : ''}>false</option>
                <option value="true" \${val ? 'selected' : ''}>true</option>
              </select></div>\`;
          }
          return \`<div><label class="label">\${esc(c)} <span class="muted">(\${esc(type)})</span></label>
            <input name="\${esc(c)}" class="input" value="\${esc(strVal)}" placeholder="\${type.includes('null') ? 'null' : ''}"></div>\`;
        }).join('')}
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button type="submit" class="btn primary">\${mode === 'create' ? 'Create Row' : 'Save Changes'}</button>
          \${mode === 'edit' ? \`
            <button id="drawer-del" type="button" class="btn danger">\${row.deleted ? 'Restore Row' : 'Soft Delete'}</button>
          \` : ''}
        </div>
      </form>
    </div>\`;
}

function renderSchedules() {
  const fns = state.status.functions || [];
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Add / Update Schedule</div>
      <form id="sched-form" style="display:grid;grid-template-columns:1fr 1fr 140px auto;gap:8px;align-items:end">
        <div><label class="label">Name</label><input name="name" class="input" placeholder="daily-cleanup" required></div>
        <div><label class="label">Function</label>
          <select name="fnName" class="select">
            \${fns.map(f => \`<option value="\${esc(f.name)}">\${esc(f.name)} (\${esc(f.kind)})</option>\`).join('') || '<option value="">No functions loaded</option>'}
          </select>
        </div>
        <div><label class="label">Cron</label><input name="cronExpr" class="input mono" value="0 * * * *"></div>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Function</th><th>Cron</th><th>Last Run</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.schedules.map(sc => \`
            <tr>
              <td class="mono">\${esc(sc.name)}</td>
              <td class="mono">\${esc(sc.fn_name)}</td>
              <td class="mono">\${esc(sc.cron_expr)}</td>
              <td>\${fmtTime(sc.last_run_at)}</td>
              <td>\${sc.last_status ? \`<span class="pill \${sc.last_status === 'ok' ? 'ok' : 'err'}">\${esc(sc.last_status)}</span>\` : '—'}</td>
              <td style="display:flex;gap:6px">
                <button type="button" class="btn sm" data-run-sched="\${esc(sc.name)}">Run Now</button>
                <button type="button" class="btn sm danger" data-del-sched="\${esc(sc.name)}">Delete</button>
              </td>
            </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No schedules configured</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderBackups() {
  return \`
    <div class="grid">
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Export Full Backup</div>
        <div class="muted" style="margin-bottom:14px">Downloads all tables from <span class="mono">schema.ts</span> as a portable JSON snapshot.</div>
        <button id="btn-export-backup" type="button" class="btn primary">Download JSON Backup</button>
      </div>
      <div class="card">
        <div style="font-weight:600;margin-bottom:6px">Restore From Backup</div>
        <div class="muted" style="margin-bottom:10px">Select a previously exported <span class="mono">.json</span> backup file to upsert rows and notify sync clients.</div>
        <input id="backup-file" type="file" accept=".json,application/json" class="input" style="margin-bottom:10px">
        <button id="btn-restore-backup" type="button" class="btn">Restore Selected File</button>
      </div>
    </div>\`;
}

function renderStorage() {
  return \`
    <div class="split">
      <div class="card" style="align-self:start">
        <div style="font-weight:600;margin-bottom:10px">Buckets</div>
        <form id="bucket-form" style="display:flex;gap:6px;margin-bottom:10px">
          <input name="name" class="input" placeholder="bucket-name" required>
          <button type="submit" class="btn primary sm">+</button>
        </form>
        <div style="display:flex;flex-direction:column;gap:4px">
          \${state.buckets.map(b => \`
            <div style="display:flex;gap:4px;align-items:center">
              <button type="button" class="nav-item \${state.selectedBucket === b.name ? 'active' : ''}" data-pick-bucket="\${esc(b.name)}" style="flex:1">
                <span class="mono">\${esc(b.name)}</span>
                <span class="pill">\${esc(b.visibility)}</span>
              </button>
              <button type="button" class="btn sm danger" data-del-bucket="\${esc(b.name)}">×</button>
            </div>\`).join('') || '<div class="muted">No buckets yet</div>'}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <strong class="mono">\${esc(state.selectedBucket || 'All buckets')}</strong>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="storage-file-input" type="file" class="input" style="max-width:240px" \${state.selectedBucket ? '' : 'disabled'}>
            <button id="btn-upload-file" type="button" class="btn primary sm" \${state.selectedBucket ? '' : 'disabled'}>Upload</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Bucket</th><th>MIME</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              \${state.files.map(f => \`
                <tr>
                  <td>\${esc(f.name)}</td>
                  <td class="mono">\${esc(f.bucket)}</td>
                  <td class="mono">\${esc(f.mime_type)}</td>
                  <td>\${Number(f.size_bytes).toLocaleString()} B</td>
                  <td>\${fmtTime(f.created_at)}</td>
                  <td><button type="button" class="btn sm danger" data-del-file="\${esc(f.id)}">Delete</button></td>
                </tr>\`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No files</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>\`;
}

function renderEnv() {
  return \`
    <div class="card" style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:10px">Set Environment Variable</div>
      <form id="env-form" style="display:grid;grid-template-columns:1fr 1.5fr auto auto;gap:8px;align-items:end">
        <div><label class="label">Key</label><input name="key" class="input mono" placeholder="MY_API_KEY" required></div>
        <div><label class="label">Value</label><input name="value" class="input" placeholder="value"></div>
        <label style="display:inline-flex;align-items:center;gap:6px;padding-bottom:8px;font-size:12.5px"><input name="isSecret" type="checkbox"> Secret</label>
        <button type="submit" class="btn primary">Save</button>
      </form>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>
          \${state.envVars.map(v => \`
            <tr>
              <td class="mono">\${esc(v.key)}</td>
              <td class="mono">\${esc(v.value)}</td>
              <td>\${fmtTime(v.updatedAt)}</td>
              <td><button type="button" class="btn sm danger" data-del-env="\${esc(v.key)}">Delete</button></td>
            </tr>\`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">No DB environment variables stored</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

function renderSettings() {
  const info = state.settingsInfo;
  if (!info) return '<div class="card muted">Loading...</div>';
  return \`
    <div class="grid">
      <div class="card">
        <div class="label">Database Connection</div>
        <div class="mono">\${esc(info.dialect)} · \${esc(info.host)}:\${info.port}/\${esc(info.database)}</div>
        <div class="muted" style="margin-top:4px">Pool size: \${info.poolSize} · Auto-migrate: \${info.autoMigrate ? 'true' : 'false'}</div>
      </div>
      <div class="card">
        <div class="label">HTTP &amp; Storage</div>
        <div class="mono">CORS: \${esc((info.corsOrigins || []).join(', '))}</div>
        <div class="muted" style="margin-top:4px">Uploads: \${esc(info.uploadDir)} · SMTP: \${info.smtp ? esc(info.smtp.host) : 'not configured'}</div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>Pending Schema SQL (\${(info.pendingSql || []).length})</strong>
        \${(info.pendingSql || []).length ? '<button id="btn-apply-schema" type="button" class="btn primary sm">Apply Migrations Now</button>' : '<span class="pill ok">Up to date</span>'}
      </div>
      \${(info.pendingSql || []).length ? \`<pre class="card mono" style="background:var(--bg);overflow:auto;font-size:12px">\${esc(info.pendingSql.join('\\n\\n'))}</pre>\` : '<div class="muted">All tables and columns from schema.ts are applied.</div>'}
    </div>\`;
}

function render() {
  if (!state.authed || !state.status) return renderGate();
  const s = state.status;
  const nav = [
    ['overview', 'Overview', ''],
    ['data', 'Data', Object.keys(s.tables || {}).length],
    ['users', 'Auth & Users', s.accounts?.users ?? 0],
    ['functions', 'Functions', (s.functions || []).length],
    ['schedules', 'Schedules', ''],
    ['backups', 'Backups', ''],
    ['storage', 'Storage', ''],
    ['logs', 'Sync Logs', ''],
    ['env', 'Environment', ''],
    ['settings', 'Settings', ''],
  ];
  let body = '';
  if (state.tab === 'overview') body = renderOverview();
  else if (state.tab === 'data') body = renderData();
  else if (state.tab === 'users') body = renderUsers();
  else if (state.tab === 'functions') body = renderFunctions();
  else if (state.tab === 'schedules') body = renderSchedules();
  else if (state.tab === 'backups') body = renderBackups();
  else if (state.tab === 'storage') body = renderStorage();
  else if (state.tab === 'logs') body = renderLogs();
  else if (state.tab === 'env') body = renderEnv();
  else if (state.tab === 'settings') body = renderSettings();

  root.innerHTML = \`
    <div class="shell">
      <aside class="sidebar">
        <div>
          <div style="padding:4px 10px 16px">
            <div style="font-size:15px;font-weight:700">__APP__</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:12px;color:var(--muted)">
              <span style="width:8px;height:8px;border-radius:50%;background:var(--success)"></span>
              <span>self-hosted · \${esc(s.dialect)}</span>
            </div>
          </div>
          <nav style="display:flex;flex-direction:column;gap:4px">
            \${nav.map(([id, label, count]) => \`
              <button type="button" class="nav-item \${state.tab === id ? 'active' : ''}" data-tab="\${id}">
                <span style="flex:1">\${label}</span>
                \${count !== '' ? \`<span class="pill">\${count}</span>\` : ''}
              </button>\`).join('')}
          </nav>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:6px">
          <button id="btn-refresh-all" type="button" class="btn sm" style="justify-content:center">Refresh Status</button>
          <button id="btn-logout" type="button" class="btn sm" style="justify-content:center">Sign Out</button>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <h1 style="margin:0;font-size:20px;font-weight:700">\${nav.find(n => n[0] === state.tab)?.[1] || ''}</h1>
          <span class="muted mono">cursor \${s.cursor}</span>
        </div>
        \${body}
      </main>
    </div>
    \${renderDrawer()}\`;

  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', async () => {
    stopSub();
    state.tab = b.dataset.tab;
    if (state.tab === 'data' && !state.tableData && state.selectedTable) await loadTable();
    else if (state.tab === 'logs') await loadLogs();
    else if (state.tab === 'users') await loadUsers();
    else if (state.tab === 'storage') await loadStorage();
    else if (state.tab === 'env') await loadEnv();
    else if (state.tab === 'schedules') await loadSchedules();
    else if (state.tab === 'settings') await loadSettingsInfo();
    else render();
  }));
  document.getElementById('btn-refresh-all')?.addEventListener('click', async () => { await loadStatus(); render(); toast('Refreshed', 'ok'); });
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    stopSub(); sessionStorage.removeItem('lls_key'); state.key = ''; state.authed = false; renderGate();
  });
  document.querySelectorAll('[data-open-table]').forEach(b => b.addEventListener('click', async () => {
    state.tab = 'data'; await loadTable(b.dataset.openTable, 0);
  }));
  document.querySelectorAll('[data-pick-table]').forEach(b => b.addEventListener('click', () => loadTable(b.dataset.pickTable, 0)));
  document.getElementById('tbl-filter')?.addEventListener('input', (e) => { state.tableFilter = e.target.value; render(); });
  document.getElementById('chk-deleted')?.addEventListener('change', (e) => { state.includeDeleted = e.target.checked; loadTable(state.selectedTable, 0); });
  document.getElementById('btn-reload-tbl')?.addEventListener('click', () => loadTable(state.selectedTable, state.tableOffset));
  document.getElementById('btn-prev')?.addEventListener('click', () => loadTable(state.selectedTable, Math.max(0, state.tableOffset - 30)));
  document.getElementById('btn-next')?.addEventListener('click', () => loadTable(state.selectedTable, state.tableOffset + 30));
  document.getElementById('btn-new-row')?.addEventListener('click', () => {
    state.drawer = { mode: 'create', table: state.selectedTable, row: {} }; render();
  });
  document.querySelectorAll('[data-row-idx]').forEach(tr => tr.addEventListener('click', () => {
    const row = state.tableData?.rows?.[Number(tr.dataset.rowIdx)];
    if (row) { state.drawer = { mode: 'edit', table: state.selectedTable, row }; render(); }
  }));
  document.getElementById('drawer-close')?.addEventListener('click', () => { state.drawer = null; render(); });
  document.getElementById('drawer-bg')?.addEventListener('click', (e) => { if (e.target.id === 'drawer-bg') { state.drawer = null; render(); } });
  document.getElementById('drawer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { mode, table, row } = state.drawer;
    const schemaCols = state.status.schema?.[table] || {};
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, raw] of fd.entries()) {
      const t = schemaCols[k] || 'string';
      if (k === 'id' && !String(raw).trim()) continue;
      if (t.startsWith('boolean')) payload[k] = raw === 'true';
      else if (t.startsWith('number')) payload[k] = raw === '' ? null : Number(raw);
      else if (t.startsWith('json') || t.startsWith('string[]')) {
        payload[k] = raw === '' ? null : JSON.parse(String(raw));
      } else payload[k] = raw === '' && t.includes('null') ? null : String(raw);
    }
    try {
      if (mode === 'create') {
        await api('/admin/tables/' + encodeURIComponent(table), { method: 'POST', body: JSON.stringify(payload) });
        toast('Row created', 'ok');
      } else {
        await api('/admin/tables/' + encodeURIComponent(table) + '/' + encodeURIComponent(row.id), { method: 'PATCH', body: JSON.stringify(payload) });
        toast('Row updated', 'ok');
      }
      state.drawer = null;
      await loadStatus();
      await loadTable(table, state.tableOffset);
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('drawer-del')?.addEventListener('click', async () => {
    const { table, row } = state.drawer;
    try {
      await api('/admin/tables/' + encodeURIComponent(table) + '/' + encodeURIComponent(row.id) + (row.deleted ? '?restore=1' : ''), { method: 'DELETE' });
      toast(row.deleted ? 'Row restored' : 'Row deleted', 'ok');
      state.drawer = null;
      await loadStatus();
      await loadTable(table, state.tableOffset);
    } catch (err) { toast(err.message, 'error'); }
  });
  document.querySelectorAll('[data-pick-fn]').forEach(b => b.addEventListener('click', () => {
    stopSub(); state.fnSelected = b.dataset.pickFn; state.fnResult = null; state.subEvents = []; render();
  }));
  document.getElementById('fn-args')?.addEventListener('input', (e) => { state.fnArgs = e.target.value; });
  document.getElementById('btn-run-fn')?.addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(state.fnArgs || '{}');
      const res = await fetch('/fn/' + state.fnSelected, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + state.key, 'content-type': 'application/json' },
        body: JSON.stringify({ args: parsed }),
      });
      const text = await res.text();
      let pretty = text; try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      state.fnResult = { status: res.status, body: pretty };
      await loadStatus();
      render();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('btn-sub-fn')?.addEventListener('click', () => {
    if (state.subSource) { stopSub(); render(); return; }
    try {
      const args = encodeURIComponent(state.fnArgs || '{}');
      const url = '/subscribe/' + state.fnSelected + '?token=' + encodeURIComponent(state.key) + '&args=' + args;
      const es = new EventSource(url);
      state.subEvents = [];
      es.addEventListener('data', (ev) => {
        let txt = ev.data; try { txt = JSON.stringify(JSON.parse(ev.data), null, 2); } catch {}
        state.subEvents = [new Date().toLocaleTimeString() + ' ' + txt, ...state.subEvents.slice(0, 9)];
        render();
      });
      es.addEventListener('error', () => toast('SSE connection closed/errored', 'error'));
      state.subSource = es;
      render();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('log-table')?.addEventListener('change', (e) => { state.logsTable = e.target.value; loadLogs(); });
  document.getElementById('btn-refresh-logs')?.addEventListener('click', loadLogs);
  document.getElementById('btn-refresh-users')?.addEventListener('click', loadUsers);
  document.querySelectorAll('[data-revoke-user]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api('/admin/users/' + encodeURIComponent(b.dataset.revokeUser) + '/revoke', { method: 'POST' });
      toast('Tokens revoked & lockout cleared', 'ok');
      await loadUsers();
    } catch (err) { toast(err.message, 'error'); }
  }));
  document.getElementById('sched-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/admin/schedules', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
      toast('Schedule saved', 'ok');
      await loadSchedules();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.querySelectorAll('[data-run-sched]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api('/admin/schedules/' + encodeURIComponent(b.dataset.runSched) + '/run', { method: 'POST' });
      toast('Schedule executed', 'ok');
      await loadSchedules();
    } catch (err) { toast(err.message, 'error'); }
  }));
  document.querySelectorAll('[data-del-sched]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api('/admin/schedules/' + encodeURIComponent(b.dataset.delSched), { method: 'DELETE' });
      await loadSchedules();
    } catch (err) { toast(err.message, 'error'); }
  }));
  document.getElementById('btn-export-backup')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/admin/backups/export', { headers: { authorization: 'Bearer ' + state.key } });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'backup-' + Date.now() + '.json';
      a.click();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('btn-restore-backup')?.addEventListener('click', async () => {
    const file = document.getElementById('backup-file')?.files?.[0];
    if (!file) return toast('Choose a .json backup file first', 'error');
    try {
      const res = await api('/admin/backups/restore', { method: 'POST', body: await file.text() });
      toast('Restored ' + res.restored + ' row(s)', 'ok');
      await loadStatus();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('bucket-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name');
    try {
      await api('/admin/storage/buckets', { method: 'POST', body: JSON.stringify({ name }) });
      state.selectedBucket = String(name);
      toast('Bucket created', 'ok');
      await loadStorage();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.querySelectorAll('[data-pick-bucket]').forEach(b => b.addEventListener('click', () => {
    state.selectedBucket = b.dataset.pickBucket; loadStorage();
  }));
  document.querySelectorAll('[data-del-bucket]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api('/admin/storage/buckets/' + encodeURIComponent(b.dataset.delBucket), { method: 'DELETE' });
      if (state.selectedBucket === b.dataset.delBucket) state.selectedBucket = '';
      await loadStorage();
    } catch (err) { toast(err.message, 'error'); }
  }));
  document.getElementById('btn-upload-file')?.addEventListener('click', async () => {
    const file = document.getElementById('storage-file-input')?.files?.[0];
    if (!file) return toast('Choose a file first', 'error');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const b64 = btoa(bin);
    try {
      await api('/admin/storage/files', {
        method: 'POST',
        body: JSON.stringify({ bucket: state.selectedBucket, name: file.name, mimeType: file.type, contentBase64: b64 }),
      });
      toast('File uploaded', 'ok');
      await loadStorage();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.querySelectorAll('[data-del-file]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api('/admin/storage/files/' + encodeURIComponent(b.dataset.delFile), { method: 'DELETE' });
      await loadStorage();
    } catch (err) { toast(err.message, 'error'); }
  }));
  document.getElementById('env-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/admin/env', {
        method: 'POST',
        body: JSON.stringify({ key: fd.get('key'), value: fd.get('value'), isSecret: fd.get('isSecret') === 'on' }),
      });
      toast('Variable saved', 'ok');
      await loadEnv();
    } catch (err) { toast(err.message, 'error'); }
  });
  document.querySelectorAll('[data-del-env]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api('/admin/env/' + encodeURIComponent(b.dataset.delEnv), { method: 'DELETE' });
      await loadEnv();
    } catch (err) { toast(err.message, 'error'); }
  }));
  document.getElementById('btn-apply-schema')?.addEventListener('click', async () => {
    try {
      const r = await api('/admin/schema/apply', { method: 'POST' });
      toast('Applied ' + r.applied + ' migration statement(s)', 'ok');
      await loadStatus();
      await loadSettingsInfo();
    } catch (err) { toast(err.message, 'error'); }
  });
}

if (state.key) {
  loadStatus().then(render).catch(() => renderGate());
} else {
  renderGate();
}
</script>
</body>
</html>`;
