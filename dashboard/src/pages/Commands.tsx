import { useEffect, useState } from 'react';
import { Play, KeyRound } from 'lucide-react';
import { apiFetch, type StatsPayload } from '../api';

export function Commands({
  stats,
  token,
}: {
  stats: StatsPayload;
  token: string;
}) {
  const [cmd, setCmd] = useState(stats.commands[0]?.name ?? '');
  const [idemKey, setIdemKey] = useState('');
  const [argsText, setArgsText] = useState('{}');
  const [output, setOutput] = useState('Command result will appear here.');

  useEffect(() => {
    if (!cmd && stats.commands.length > 0) setCmd(stats.commands[0].name);
  }, [cmd, stats.commands]);

  const run = async () => {
    if (!cmd) return;
    try {
      const args = JSON.parse(argsText || '{}');
      const res = await apiFetch(`/cmd/${cmd}`, token, {
        method: 'POST',
        headers: idemKey.trim()
          ? { 'Idempotency-Key': idemKey.trim() }
          : undefined,
        body: JSON.stringify({ args }),
      });
      setOutput(JSON.stringify(res, null, 2));
    } catch (e: any) {
      setOutput(e?.message || 'Command failed');
    }
  };

  return (
    <div className="card">
      <div className="card-title">Domain Command Runner</div>
      <div className="row">
        <select
          className="select"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
        >
          {stats.commands.length === 0 ? (
            <option value="">No commands registered</option>
          ) : (
            stats.commands.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.isolation})
              </option>
            ))
          )}
        </select>
        <input
          className="input"
          style={{ width: 220 }}
          value={idemKey}
          onChange={(e) => setIdemKey(e.target.value)}
          placeholder="Idempotency-Key (optional)"
        />
        <button
          className="btn"
          onClick={() => setIdemKey(crypto.randomUUID())}
          title="Generate UUID"
        >
          <KeyRound size={14} /> Gen Key
        </button>
        <button className="btn btn-primary" onClick={run}>
          <Play size={14} /> Run Command
        </button>
      </div>
      <textarea
        className="textarea"
        rows={5}
        value={argsText}
        onChange={(e) => setArgsText(e.target.value)}
      />
      <pre className="code">{output}</pre>
    </div>
  );
}
