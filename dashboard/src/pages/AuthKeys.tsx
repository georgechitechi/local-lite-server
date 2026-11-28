import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../api';

export function AuthKeys({
  token,
  onError,
}: {
  token: string;
  onError: (msg: string) => void;
}) {
  const [keys, setKeys] = useState<Array<Record<string, any>>>([]);
  const [accounts, setAccounts] = useState<Array<Record<string, any>>>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('admin');
  const [createdKey, setCreatedKey] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{
        keys: Array<Record<string, any>>;
        accounts: Array<Record<string, any>>;
      }>('/api/auth', token);
      setKeys(res.keys);
      setAccounts(res.accounts);
      onError('');
    } catch (e: any) {
      onError(e?.message || 'Failed to load auth data');
    }
  }, [token, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const createKey = async () => {
    if (!name.trim()) return;
    const res = await apiFetch<{ key: string }>('/api/keys', token, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), role }),
    });
    setCreatedKey(res.key);
    setName('');
    await load();
  };

  const deleteKey = async (id: string) => {
    await apiFetch(`/api/keys/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    });
    await load();
  };

  return (
    <div className="two-col">
      <div className="card">
        <div className="card-title">API Keys</div>
        <div className="row">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. Mobile Sync)"
          />
          <select
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
          >
            <option value="admin">admin</option>
            <option value="user">user</option>
          </select>
          <button className="btn btn-primary" onClick={createKey}>
            <Plus size={14} /> Create
          </button>
        </div>
        {createdKey && (
          <pre className="code" style={{ marginBottom: 12 }}>
            Save this key now (shown once):{'\n'}
            {createdKey}
          </pre>
        )}
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={5} className="kpi-sub">
                  No API keys.
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>{k.keyPrefix}</td>
                  <td>{k.role}</td>
                  <td>{k.revokedAt ? 'revoked' : 'active'}</td>
                  <td>
                    <button
                      className="btn btn-danger"
                      onClick={() => deleteKey(k.id)}
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

      <div className="card">
        <div className="card-title">User Accounts (_local_auth_accounts)</div>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={3} className="kpi-sub">
                  No user accounts.
                </td>
              </tr>
            ) : (
              accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.email}</td>
                  <td>{a.display_name || ''}</td>
                  <td>{a.created_at}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
