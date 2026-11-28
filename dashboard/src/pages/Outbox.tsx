import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { apiFetch } from '../api';

export function Outbox({
  token,
  onError,
}: {
  token: string;
  onError: (msg: string) => void;
}) {
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ rows: Array<Record<string, any>> }>(
        `/api/outbox?status=${encodeURIComponent(status)}`,
        token,
      );
      setRows(res.rows);
      onError('');
    } catch (e: any) {
      onError(e?.message || 'Failed to load outbox');
    }
  }, [status, token, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (id: string) => {
    await apiFetch('/api/outbox/retry', token, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    await load();
  };

  const purgeDelivered = async () => {
    await apiFetch('/api/outbox/purge', token, { method: 'POST' });
    await load();
  };

  return (
    <div className="card">
      <div className="row">
        <select
          className="select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="delivered">Delivered</option>
          <option value="dead_letter">Dead Letter</option>
        </select>
        <button className="btn" onClick={purgeDelivered}>
          <Trash2 size={14} /> Purge Delivered
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Topic</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Last Error</th>
            <th>Payload</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="kpi-sub">
                Outbox is empty.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td>{r.topic}</td>
                <td>
                  <span
                    className={`pill ${r.status === 'delivered' ? 'ok' : r.status === 'dead_letter' ? 'bad' : 'warn'}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td>{r.attempts}</td>
                <td style={{ color: 'var(--bad)', fontSize: 12 }}>
                  {r.last_error || ''}
                </td>
                <td>
                  <pre className="code" style={{ margin: 0, maxHeight: 100 }}>
                    {r.payload_json}
                  </pre>
                </td>
                <td>
                  {r.status !== 'delivered' && (
                    <button className="btn" onClick={() => retry(r.id)}>
                      <RotateCcw size={13} /> Retry
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
