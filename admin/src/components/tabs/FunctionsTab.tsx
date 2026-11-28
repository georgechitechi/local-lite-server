import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch, buildApiUrl } from '@/lib/api';
import {
  cardStyle,
  inputStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
  sectionTitleStyle,
} from '@/styles/adminStyles';
import type { EndpointItem } from '@/types/admin';

interface ServerFnItem {
  name: string;
  kind: 'query' | 'mutation' | 'action';
}

export function FunctionsTab({
  endpoints,
  activeProjectSlug = null,
}: {
  endpoints: EndpointItem[];
  activeProjectSlug?: string | null;
}) {
  const [serverFns, setServerFns] = useState<ServerFnItem[]>([]);
  const [selectedFn, setSelectedFn] = useState<string>('');
  const [fnArgs, setFnArgs] = useState('{\n  \n}');
  const [fnResult, setFnResult] = useState<{
    status: number;
    body: string;
  } | null>(null);
  const [fnLoading, setFnLoading] = useState(false);

  const [subActive, setSubActive] = useState(false);
  const [subEvents, setSubEvents] = useState<string[]>([]);
  const subRef = useRef<EventSource | null>(null);

  const [runnerMethod, setRunnerMethod] = useState<'GET' | 'POST'>('GET');
  const [runnerPath, setRunnerPath] = useState('/health');
  const [runnerBody, setRunnerBody] = useState('{\n  \n}');
  const [runnerResult, setRunnerResult] = useState<{
    status: number;
    body: string;
  } | null>(null);
  const [runnerLoading, setRunnerLoading] = useState(false);

  const stopSub = useCallback(() => {
    subRef.current?.close();
    subRef.current = null;
    setSubActive(false);
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await adminFetch('/fn', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as {
        functions?: ServerFnItem[];
      };
      const list = Array.isArray(data.functions) ? data.functions : [];
      setServerFns(list);
      if (list.length > 0) setSelectedFn((prev) => prev || list[0].name);
    })();
    return () => stopSub();
  }, [stopSub]);

  const currentFn =
    serverFns.find((f) => f.name === selectedFn) ?? serverFns[0];

  const runServerFn = async () => {
    if (!currentFn) return;
    setFnLoading(true);
    setFnResult(null);
    try {
      const parsed = JSON.parse(fnArgs.trim() || '{}');
      const prefix = activeProjectSlug ? `/p/${activeProjectSlug}` : '';
      const res = await adminFetch(`${prefix}/fn/${currentFn.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: parsed }),
      });
      const text = await res.text();
      let formatted = text;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}
      setFnResult({ status: res.status, body: formatted });
    } catch (err: any) {
      setFnResult({ status: 0, body: err?.message || 'Execution failed.' });
    } finally {
      setFnLoading(false);
    }
  };

  const toggleSubscribe = () => {
    if (subActive) {
      stopSub();
      return;
    }
    if (!currentFn || currentFn.kind !== 'query') return;
    try {
      const parsed = JSON.parse(fnArgs.trim() || '{}');
      const prefix = activeProjectSlug ? `/p/${activeProjectSlug}` : '';
      const url = buildApiUrl(
        `${prefix}/subscribe/${currentFn.name}?args=${encodeURIComponent(JSON.stringify(parsed))}`,
      );
      const es = new EventSource(url, { withCredentials: true });
      setSubEvents([]);
      es.addEventListener('data', (ev) => {
        let pretty = ev.data;
        try {
          pretty = JSON.stringify(JSON.parse(ev.data), null, 2);
        } catch {}
        setSubEvents((prev) => [
          `${new Date().toLocaleTimeString()}\n${pretty}`,
          ...prev.slice(0, 9),
        ]);
      });
      es.addEventListener('error', () => {
        setSubEvents((prev) => [
          `${new Date().toLocaleTimeString()} SSE connection error/closed`,
          ...prev.slice(0, 9),
        ]);
      });
      subRef.current = es;
      setSubActive(true);
    } catch (err: any) {
      setFnResult({ status: 0, body: err?.message || 'Invalid JSON args.' });
    }
  };

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
      setRunnerResult({ status: 0, body: err?.message || 'Request failed.' });
    } finally {
      setRunnerLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="split-grid-280">
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>
            Server Functions ({serverFns.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {serverFns.map((fn) => {
              const active = currentFn?.name === fn.name;
              return (
                <button
                  key={fn.name}
                  type="button"
                  onClick={() => {
                    stopSub();
                    setSelectedFn(fn.name);
                    setFnResult(null);
                    setSubEvents([]);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '9px 11px',
                    borderRadius: 8,
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: 12.5,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'monospace',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {fn.name}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 7px',
                      borderRadius: 999,
                      background: 'var(--surface-alt)',
                      color: 'var(--accent)',
                    }}
                  >
                    {fn.kind}
                  </span>
                </button>
              );
            })}
            {serverFns.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                No functions found in <code>functions/</code>.
              </div>
            )}
          </div>
        </section>

        <section style={cardStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <div>
              <h2
                style={{
                  ...sectionTitleStyle,
                  margin: 0,
                  fontFamily: 'monospace',
                }}
              >
                {currentFn ? currentFn.name : 'Select a function'}
              </h2>
              <div
                style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}
              >
                POST /fn/{currentFn?.name || '...'}
              </div>
            </div>
            {currentFn && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '3px 9px',
                  borderRadius: 999,
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                {currentFn.kind}
              </span>
            )}
          </div>

          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
            Arguments (JSON)
          </div>
          <textarea
            value={fnArgs}
            onChange={(e) => setFnArgs(e.target.value)}
            rows={5}
            style={{
              ...inputStyle,
              height: 'auto',
              padding: 12,
              fontFamily: 'monospace',
              fontSize: 12.5,
            }}
          />

          <div
            style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}
          >
            <button
              type="button"
              onClick={runServerFn}
              disabled={!currentFn || fnLoading}
              style={primaryBtnStyle}
            >
              {fnLoading ? 'Running...' : 'Run Function'}
            </button>
            {currentFn?.kind === 'query' && (
              <button
                type="button"
                onClick={toggleSubscribe}
                style={secondaryBtnStyle}
              >
                {subActive ? 'Stop Subscribe' : 'Subscribe (SSE)'}
              </button>
            )}
          </div>

          {fnResult && (
            <div style={{ marginTop: 14 }}>
              <div
                style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}
              >
                Result (HTTP {fnResult.status})
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  maxHeight: 280,
                  overflow: 'auto',
                }}
              >
                {fnResult.body}
              </pre>
            </div>
          )}

          {subEvents.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div
                style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}
              >
                Live SSE Updates ({subEvents.length})
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  maxHeight: 240,
                  overflow: 'auto',
                }}
              >
                {subEvents.join('\n---\n')}
              </pre>
            </div>
          )}
        </section>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 16,
        }}
      >
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Registered HTTP Endpoints</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {endpoints.map((ep, idx) => {
              const epPath = ep.path || '/';
              return (
                <button
                  key={`${ep.method}-${epPath}-${idx}`}
                  type="button"
                  onClick={() => {
                    setRunnerPath(epPath);
                    if (ep.method === 'GET' || ep.method === 'POST')
                      setRunnerMethod(ep.method);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: 12.5,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      minWidth: 54,
                      fontWeight: 700,
                      color: 'var(--accent)',
                      fontSize: 11,
                    }}
                  >
                    {ep.method || 'ANY'}
                  </span>
                  <span style={{ fontFamily: 'monospace' }}>{epPath}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Raw Endpoint Tester</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <select
              value={runnerMethod}
              onChange={(e) =>
                setRunnerMethod(e.target.value as 'GET' | 'POST')
              }
              style={{ ...inputStyle, width: 100 }}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
            <input
              value={runnerPath}
              onChange={(e) => setRunnerPath(e.target.value)}
              placeholder="/health"
              style={{ ...inputStyle, fontFamily: 'monospace' }}
            />
            <button
              type="button"
              onClick={runApiTester}
              disabled={runnerLoading}
              style={primaryBtnStyle}
            >
              {runnerLoading ? 'Sending...' : 'Send'}
            </button>
          </div>
          {runnerMethod === 'POST' && (
            <textarea
              value={runnerBody}
              onChange={(e) => setRunnerBody(e.target.value)}
              rows={4}
              style={{
                ...inputStyle,
                height: 'auto',
                padding: 12,
                fontFamily: 'monospace',
                fontSize: 12.5,
                marginBottom: 10,
              }}
            />
          )}
          {runnerResult && (
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 8,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                fontSize: 12,
                maxHeight: 240,
                overflow: 'auto',
              }}
            >
              {`HTTP ${runnerResult.status}\n${runnerResult.body}`}
            </pre>
          )}
        </section>
      </div>
    </div>
  );
}
