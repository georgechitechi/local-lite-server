import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch, type StatsPayload } from '../api';

export function DataBrowser({
  stats,
  token,
  onError,
}: {
  stats: StatsPayload;
  token: string;
  onError: (msg: string) => void;
}) {
  const tables = stats.tables.map((t) => t.name);
  const [table, setTable] = useState(tables[0] ?? '');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [showInsert, setShowInsert] = useState(false);
  const [draftJson, setDraftJson] = useState('{\n  "title": "New item"\n}');

  useEffect(() => {
    if (!table && tables.length > 0) setTable(tables[0]);
  }, [table, tables]);

  const loadRows = useCallback(async () => {
    if (!table) return;
    try {
      const res = await apiFetch<{ rows: Array<Record<string, any>> }>(
        `/dashboard/api/rows?table=${encodeURIComponent(table)}&limit=50&includeDeleted=${includeDeleted ? '1' : '0'}`,
        token,
      );
      setRows(res.rows);
      onError('');
    } catch (e: any) {
      onError(e?.message || 'Failed to load rows');
    }
  }, [table, includeDeleted, token, onError]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const insertRow = async () => {
    try {
      const data = JSON.parse(draftJson);
      await apiFetch('/dashboard/api/rows', token, {
        method: 'POST',
        body: JSON.stringify({ action: 'insert', table, data }),
      });
      setShowInsert(false);
      await loadRows();
    } catch (e: any) {
      onError(e?.message || 'Insert failed');
    }
  };

  const removeRow = async (id: string) => {
    try {
      await apiFetch('/dashboard/api/rows', token, {
        method: 'POST',
        body: JSON.stringify({ action: 'remove', table, id }),
      });
      await loadRows();
    } catch (e: any) {
      onError(e?.message || 'Delete failed');
    }
  };

  if (tables.length === 0) {
    return <div className="card">No schema tables defined.</div>;
  }

  return (
    <div className="card">
      <div className="row">
        <select
          className="select"
          value={table}
          onChange={(e) => setTable(e.target.value)}
        >
          {tables.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="kpi-sub" style={{ margin: 0, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => setIncludeDeleted(e.target.checked)}
          />{' '}
          Include deleted
        </label>
        <button
          className="btn btn-primary"
          onClick={() => setShowInsert((v) => !v)}
        >
          <Plus size={14} /> Insert Row
        </button>
      </div>

      {showInsert && (
        <div style={{ marginBottom: 14 }}>
          <div className="card-title">Insert JSON Row into {table}</div>
          <textarea
            className="textarea"
            rows={4}
            value={draftJson}
            onChange={(e) => setDraftJson(e.target.value)}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-primary" onClick={insertRow}>
              Save Row
            </button>
            <button className="btn" onClick={() => setShowInsert(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Payload</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="kpi-sub">
                No rows found.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.id}</td>
                <td>
                  <pre className="code" style={{ margin: 0, maxHeight: 120 }}>
                    {JSON.stringify(r, null, 2)}
                  </pre>
                </td>
                <td>{r.updated_at}</td>
                <td>
                  <button
                    className="btn btn-danger"
                    onClick={() => removeRow(r.id)}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
