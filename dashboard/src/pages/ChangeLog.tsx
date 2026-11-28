import { useCallback, useEffect, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { apiFetch, type StatsPayload } from '../api';

export function ChangeLog({
  stats,
  token,
  onError,
  onRefreshStats,
}: {
  stats: StatsPayload;
  token: string;
  onError: (msg: string) => void;
  onRefreshStats: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [days, setDays] = useState('30');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ rows: Array<Record<string, any>> }>(
        '/api/changes?limit=50',
        token,
      );
      setRows(res.rows);
      onError('');
    } catch (e: any) {
      onError(e?.message || 'Failed to load change log');
    }
  }, [token, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const compact = async () => {
    try {
      const out = await apiFetch<{ deleted: number; compactedFloor: number }>(
        '/api/changes/compact',
        token,
        {
          method: 'POST',
          body: JSON.stringify({ retentionDays: Number(days || 30) }),
        },
      );
      setMsg(
        `Pruned ${out.deleted} row(s). New compacted floor: ${out.compactedFloor}`,
      );
      await Promise.all([load(), onRefreshStats()]);
    } catch (e: any) {
      onError(e?.message || 'Compaction failed');
    }
  };

  return (
    <div className="card">
      <div className="row">
        <span className="kpi-sub" style={{ margin: 0 }}>
          Checkpoint: <strong>{stats.sync.checkpoint}</strong> · Compacted
          floor: <strong>{stats.sync.compactedFloor}</strong>
        </span>
        <input
          className="input"
          type="number"
          style={{ width: 90 }}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
        <button className="btn btn-primary" onClick={compact}>
          <Minimize2 size={14} /> Compact Older Than Days
        </button>
      </div>
      {msg && (
        <div className="pill ok" style={{ marginBottom: 10 }}>
          {msg}
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Table</th>
            <th>Row ID</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="kpi-sub">
                No changes logged.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.table_name}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {r.row_id}
                </td>
                <td>{r.ts}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
