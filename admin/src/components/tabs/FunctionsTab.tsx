import { useState } from 'react';
import { buildApiUrl } from '@/lib/api';
import {
  cardStyle,
  inputStyle,
  primaryBtnStyle,
  sectionTitleStyle,
} from '@/styles/adminStyles';
import type { EndpointItem } from '@/types/admin';

export function FunctionsTab({ endpoints }: { endpoints: EndpointItem[] }) {
  const [runnerMethod, setRunnerMethod] = useState<'GET' | 'POST'>('GET');
  const [runnerPath, setRunnerPath] = useState('/health');
  const [runnerBody, setRunnerBody] = useState('{\n  \n}');
  const [runnerResult, setRunnerResult] = useState<{
    status: number;
    body: string;
  } | null>(null);
  const [runnerLoading, setRunnerLoading] = useState(false);

  const runApiTester = async () => {
    setRunnerLoading(true);
    setRunnerResult(null);
    try {
      const cleanPath = runnerPath.startsWith('/')
        ? runnerPath
        : `/${runnerPath}`;
      const res = await fetch(buildApiUrl(cleanPath), {
        method: runnerMethod,
        credentials: 'include',
        headers:
          runnerMethod === 'POST'
            ? { 'Content-Type': 'application/json' }
            : undefined,
        body: runnerMethod === 'POST' ? runnerBody : undefined,
      });
      const text = await res.text();
      let formatted = text;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}
      setRunnerResult({ status: res.status, body: formatted });
    } catch (err: any) {
      setRunnerResult({
        status: 0,
        body: err?.message || 'Request failed.',
      });
    } finally {
      setRunnerLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 16,
      }}
    >
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Registered API Endpoints</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {endpoints.map((ep, idx) => {
            const epPath = ep.path || '/';
            return (
              <button
                key={`${ep.method}-${epPath}-${idx}`}
                type="button"
                onClick={() => {
                  setRunnerMethod(ep.method === 'POST' ? 'POST' : 'GET');
                  setRunnerPath(epPath);
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 7,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  display: 'flex',
                  gap: 10,
                  fontSize: 12.5,
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ color: 'var(--accent)', minWidth: 44 }}>
                  {ep.method || 'ANY'}
                </span>
                <span>{epPath}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>Run Endpoint Request</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <select
            value={runnerMethod}
            onChange={(e) => setRunnerMethod(e.target.value as 'GET' | 'POST')}
            style={{ ...inputStyle, width: 96 }}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
          <input
            value={runnerPath}
            onChange={(e) => setRunnerPath(e.target.value)}
            placeholder="/health"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => void runApiTester()}
            disabled={runnerLoading}
            style={primaryBtnStyle}
          >
            {runnerLoading ? 'Running...' : 'Run'}
          </button>
        </div>

        {runnerMethod === 'POST' && (
          <textarea
            value={runnerBody}
            onChange={(e) => setRunnerBody(e.target.value)}
            rows={5}
            style={{
              ...inputStyle,
              height: 'auto',
              padding: 12,
              fontFamily: 'monospace',
              fontSize: 12.5,
              marginBottom: 10,
              width: '100%',
            }}
          />
        )}

        {runnerResult && (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                fontSize: 12,
                marginBottom: 6,
                color:
                  runnerResult.status >= 200 && runnerResult.status < 300
                    ? 'var(--success)'
                    : 'var(--danger)',
              }}
            >
              HTTP {runnerResult.status}
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                overflowX: 'auto',
                maxHeight: 340,
              }}
            >
              {runnerResult.body}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
