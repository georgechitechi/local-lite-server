import { useEffect, useRef, useState } from 'react';
import { Radio, RefreshCw, Camera } from 'lucide-react';
import { apiFetch, type StatsPayload } from '../api';

export function Lenses({
  stats,
  token,
}: {
  stats: StatsPayload;
  token: string;
}) {
  const [lens, setLens] = useState(stats.lenses[0] ?? '');
  const [since, setSince] = useState('0');
  const [argsText, setArgsText] = useState('{}');
  const [output, setOutput] = useState(
    'Select a lens and click Pull Deltas, Snapshot, or Stream via /ws.',
  );
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!lens && stats.lenses.length > 0) setLens(stats.lenses[0]);
  }, [lens, stats.lenses]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const pullDeltas = async () => {
    if (!lens) return;
    try {
      const res = await apiFetch(
        `/sync/lens/${encodeURIComponent(lens)}?since=${encodeURIComponent(since)}&args=${encodeURIComponent(argsText)}`,
        token,
      );
      setOutput(JSON.stringify(res, null, 2));
    } catch (e: any) {
      setOutput(e?.message || 'Pull failed');
    }
  };

  const fetchSnapshot = async () => {
    if (!lens) return;
    try {
      const res = await apiFetch(
        `/sync/snapshot/${encodeURIComponent(lens)}?format=json&args=${encodeURIComponent(argsText)}`,
        token,
      );
      setOutput(JSON.stringify(res, null, 2));
    } catch (e: any) {
      setOutput(e?.message || 'Snapshot failed');
    }
  };

  const toggleWs = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setWsConnected(false);
      return;
    }
    if (!lens) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token.trim())}`,
    );
    wsRef.current = ws;
    setWsConnected(true);
    setOutput('Connecting to /ws...');

    ws.onopen = () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(argsText || '{}');
      } catch {
        parsed = {};
      }
      ws.send(
        JSON.stringify({
          type: 'subscribeLens',
          id: 'dash-lens',
          lens,
          since: Number(since || 0),
          args: parsed,
        }),
      );
    };
    ws.onmessage = (ev) => {
      setOutput((prev) => `${ev.data}\n\n${prev}`.slice(0, 6000));
    };
    ws.onclose = () => {
      wsRef.current = null;
      setWsConnected(false);
    };
  };

  return (
    <div className="card">
      <div className="card-title">Sync Lens Explorer &amp; WebSocket Stream</div>
      <div className="row">
        <select
          className="select"
          value={lens}
          onChange={(e) => setLens(e.target.value)}
        >
          {stats.lenses.length === 0 ? (
            <option value="">No lenses registered</option>
          ) : (
            stats.lenses.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))
          )}
        </select>
        <input
          className="input"
          type="number"
          style={{ width: 110 }}
          value={since}
          onChange={(e) => setSince(e.target.value)}
          placeholder="since"
        />
        <button className="btn btn-primary" onClick={pullDeltas}>
          <RefreshCw size={14} /> Pull Deltas
        </button>
        <button className="btn" onClick={fetchSnapshot}>
          <Camera size={14} /> Snapshot
        </button>
        <button
          className={`btn ${wsConnected ? 'btn-danger' : ''}`}
          onClick={toggleWs}
        >
          <Radio size={14} /> {wsConnected ? 'Disconnect WS' : 'Stream via /ws'}
        </button>
      </div>
      <textarea
        className="textarea"
        rows={3}
        value={argsText}
        onChange={(e) => setArgsText(e.target.value)}
      />
      <pre className="code">{output}</pre>
    </div>
  );
}
