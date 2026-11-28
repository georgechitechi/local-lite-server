import type { StatsPayload } from '../api';

function fmtUptime(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function Overview({ stats }: { stats: StatsPayload }) {
  return (
    <>
      <div className="kpi-grid">
        <div className="card">
          <div className="card-title">Sync Clock</div>
          <div className="kpi-val">{stats.sync.checkpoint}</div>
          <div className="kpi-sub">
            Compacted floor: {stats.sync.compactedFloor}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Change Log</div>
          <div className="kpi-val">{stats.sync.changeLogCount}</div>
          <div className="kpi-sub">_server_changes rows</div>
        </div>
        <div className="card">
          <div className="card-title">WebSocket &amp; Presence</div>
          <div className="kpi-val">{stats.ws.connectedClients} clients</div>
          <div className="kpi-sub">
            {stats.ws.activeLensSubs} lens subs · {stats.ws.presenceRooms}{' '}
            rooms ({stats.ws.presenceMembers} users)
          </div>
        </div>
        <div className="card">
          <div className="card-title">Outbox Queue</div>
          <div className="kpi-val">{stats.outbox.pending} pending</div>
          <div className="kpi-sub">
            {stats.outbox.delivered} delivered · {stats.outbox.deadLetter}{' '}
            dead_letter
          </div>
        </div>
        <div className="card">
          <div className="card-title">Runtime</div>
          <div className="kpi-val">{fmtUptime(stats.server.uptimeMs)}</div>
          <div className="kpi-sub">
            {stats.server.dialect} · RSS {stats.server.memoryMb} MB ·{' '}
            {stats.server.nodeVersion}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-title">Schema Tables</div>
          <table className="table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Active Rows</th>
              </tr>
            </thead>
            <tbody>
              {stats.tables.length === 0 ? (
                <tr>
                  <td colSpan={2} className="kpi-sub">
                    No schema tables defined.
                  </td>
                </tr>
              ) : (
                stats.tables.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td>{t.count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Registered Engine Surface</div>
          <div className="kpi-sub" style={{ marginBottom: 6 }}>
            Commands
          </div>
          <div>
            {stats.commands.length ? (
              stats.commands.map((c) => (
                <span key={c.name} className="pill">
                  {c.name} ({c.isolation})
                </span>
              ))
            ) : (
              <span className="kpi-sub">None</span>
            )}
          </div>

          <div className="kpi-sub" style={{ marginTop: 12, marginBottom: 6 }}>
            Sync Lenses
          </div>
          <div>
            {stats.lenses.length ? (
              stats.lenses.map((l) => (
                <span key={l} className="pill ok">
                  {l}
                </span>
              ))
            ) : (
              <span className="kpi-sub">None</span>
            )}
          </div>

          <div className="kpi-sub" style={{ marginTop: 12, marginBottom: 6 }}>
            Projections
          </div>
          <div>
            {stats.projections.length ? (
              stats.projections.map((p) => (
                <span key={p} className="pill">
                  {p}
                </span>
              ))
            ) : (
              <span className="kpi-sub">None</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
