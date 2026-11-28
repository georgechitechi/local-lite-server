import { useState } from 'react';
import { Check, KeyRound, Trash2 } from 'lucide-react';
import { setStoredToken, type StatsPayload } from '../api';

export function Settings({
  token,
  onSaveToken,
  autoRefresh,
  onToggleAutoRefresh,
  stats,
}: {
  token: string;
  onSaveToken: (next: string) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: (next: boolean) => void;
  stats: StatsPayload | null;
}) {
  const [draft, setDraft] = useState(token);
  const [saved, setSaved] = useState(false);

  const save = () => {
    const clean = draft.trim();
    setStoredToken(clean);
    onSaveToken(clean);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clear = () => {
    setDraft('');
    setStoredToken('');
    onSaveToken('');
  };

  return (
    <div className="two-col">
      <div className="card">
        <div className="card-title">
          <span>Authentication</span>
          <KeyRound size={14} />
        </div>
        <div className="kpi-sub" style={{ marginBottom: 12 }}>
          Enter your <code>SERVER_API_KEY</code> (stored in{' '}
          <code>sessionStorage</code> for this browser tab).
        </div>
        <div className="row">
          <input
            className="input"
            type="password"
            style={{ flex: 1, minWidth: 220 }}
            placeholder="Paste SERVER_API_KEY..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
          <button className="btn btn-primary" onClick={save}>
            <Check size={14} /> {saved ? 'Saved' : 'Save Key'}
          </button>
          <button className="btn btn-danger" onClick={clear}>
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Dashboard Preferences</div>
        <label
          className="row"
          style={{ cursor: 'pointer', marginBottom: 12, fontSize: 13.5 }}
        >
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => onToggleAutoRefresh(e.target.checked)}
          />
          Auto-refresh metrics every 5 seconds
        </label>
        {stats && (
          <div className="kpi-sub">
            Connected to <strong>{stats.server.dialect}</strong> · Node{' '}
            <strong>{stats.server.nodeVersion}</strong> · Multi-instance:{' '}
            <strong>{stats.server.multiInstance ? 'enabled' : 'off'}</strong>
          </div>
        )}
      </div>
    </div>
  );
}
