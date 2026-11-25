import { useEffect, useMemo, useState } from 'react';
import { PaginationBar } from '@/components/PaginationBar';
import { PasswordInput } from '@/components/PasswordInput';
import { formatTime } from '@/lib/formatters';
import {
  cardStyle,
  compactPrimaryBtnStyle,
  inputStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
  sectionTitleStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '@/styles/adminStyles';
import type { LocalAuthAccount } from '@/types/admin';

const PAGE_SIZE = 30;
type UserFilter = 'all' | 'console' | 'app';
type DrawerState =
  { mode: 'closed' } | { mode: 'create' } | { mode: 'manage'; userId: string };

export function AuthUsersTab({
  accounts,
  onAction,
}: {
  accounts: LocalAuthAccount[];
  onAction: (
    payload: Record<string, any>,
    successMsg: string,
  ) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState<UserFilter>('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [drawer, setDrawer] = useState<DrawerState>({ mode: 'closed' });

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [consoleRole, setConsoleRole] = useState<'admin' | 'super_admin'>(
    'admin',
  );
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((acc) => {
      if (filter === 'console' && !acc.consoleActive) return false;
      if (filter === 'app' && acc.consoleActive) return false;
      if (!q) return true;
      return (
        acc.email.toLowerCase().includes(q) ||
        (acc.displayName || '').toLowerCase().includes(q)
      );
    });
  }, [accounts, filter, search]);

  const safeOffset = offset >= filtered.length ? 0 : offset;
  const pageRows = filtered.slice(safeOffset, safeOffset + PAGE_SIZE);
  const hasPrev = safeOffset > 0;
  const hasNext = safeOffset + pageRows.length < filtered.length;
  useEffect(() => {
    if (drawer.mode === 'closed') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawer({ mode: 'closed' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawer.mode]);

  const selectedUser =
    drawer.mode === 'manage'
      ? (accounts.find((a) => a.id === drawer.userId) ?? null)
      : null;

  const openCreate = () => {
    setEmail('');
    setDisplayName('');
    setPassword('');
    setConsoleRole('admin');
    setDrawer({ mode: 'create' });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await onAction(
        {
          action: 'create_console_user',
          email,
          password,
          displayName: displayName.trim() || undefined,
          consoleRole,
        },
        `Created console admin ${email}`,
      );
      if (ok) {
        setDrawer({ mode: 'closed' });
      }
    } finally {
      setBusy(false);
    }
  };

  const runUserAction = async (
    payload: Record<string, any>,
    successMsg: string,
    closeAfter = false,
  ) => {
    setBusy(true);
    try {
      const ok = await onAction(payload, successMsg);
      if (ok && closeAfter) setDrawer({ mode: 'closed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Users & Access</h2>
          <button
            type="button"
            onClick={openCreate}
            style={compactPrimaryBtnStyle}
          >
            + New Console Admin
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {(
              [
                ['all', 'All'],
                ['console', 'Console Admins'],
                ['app', 'App Users'],
              ] as Array<[UserFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setFilter(key);
                  setOffset(0);
                }}
                style={{
                  ...secondaryBtnStyle,
                  background:
                    filter === key ? 'var(--accent-soft)' : 'transparent',
                  color: filter === key ? 'var(--accent)' : 'var(--muted)',
                  borderColor:
                    filter === key ? 'var(--accent)' : 'var(--border)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search email or name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            style={{ ...inputStyle, maxWidth: 260, padding: '7px 12px' }}
          />
        </div>

        {pageRows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={thStyle}>User</th>
                  <th style={thStyle}>Access</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Created</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Manage</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((acc) => {
                  const locked =
                    acc.lockedUntil != null && acc.lockedUntil > Date.now();
                  return (
                    <tr
                      key={acc.id}
                      onClick={() =>
                        setDrawer({ mode: 'manage', userId: acc.id })
                      }
                      style={{
                        borderTop: '1px solid var(--border)',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 500 }}>{acc.email}</div>
                        {acc.displayName && (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {acc.displayName}
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {acc.consoleActive ? (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 11.5,
                              fontWeight: 600,
                              background: 'var(--accent-soft)',
                              color: 'var(--accent)',
                            }}
                          >
                            {acc.consoleRole === 'super_admin'
                              ? 'Super Admin'
                              : 'Console Admin'}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                            App User
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            color: locked ? 'var(--danger)' : 'var(--success)',
                          }}
                        >
                          {locked ? 'Locked' : 'Active'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--muted)' }}>
                        {formatTime(acc.createdAt)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawer({ mode: 'manage', userId: acc.id });
                          }}
                          style={secondaryBtnStyle}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            No matching accounts found.
          </p>
        )}

        <PaginationBar
          total={filtered.length}
          offset={safeOffset}
          count={pageRows.length}
          unit="account"
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={() => setOffset(Math.max(0, safeOffset - PAGE_SIZE))}
          onNext={() => setOffset(safeOffset + PAGE_SIZE)}
        />
      </section>

      {drawer.mode !== 'closed' && (
        <div
          onClick={() => setDrawer({ mode: 'closed' })}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            zIndex: 50,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 400,
              height: '100%',
              background: 'var(--surface)',
              borderLeft: '1px solid var(--border)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              overflowY: 'auto',
              boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.45)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border)',
                paddingBottom: 14,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                {drawer.mode === 'create' ? 'New Console Admin' : 'Manage User'}
              </h3>
              <button
                type="button"
                onClick={() => setDrawer({ mode: 'closed' })}
                style={secondaryBtnStyle}
              >
                Close
              </button>
            </div>

            {drawer.mode === 'create' && (
              <form
                onSubmit={handleCreate}
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  Email
                  <input
                    type="email"
                    placeholder="admin@ogsadmin.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{ ...inputStyle, marginTop: 6 }}
                  />
                </label>
                <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  Display name (optional)
                  <input
                    type="text"
                    placeholder="Jane Doe"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    style={{ ...inputStyle, marginTop: 6 }}
                  />
                </label>
                <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  Password (min 8 characters)
                  <div style={{ marginTop: 6 }}>
                    <PasswordInput
                      placeholder="Password"
                      value={password}
                      onChange={setPassword}
                      required
                      autoComplete="new-password"
                    />
                  </div>
                </label>
                <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  Console Role
                  <select
                    value={consoleRole}
                    onChange={(e) =>
                      setConsoleRole(
                        e.target.value === 'super_admin'
                          ? 'super_admin'
                          : 'admin',
                      )
                    }
                    style={{ ...inputStyle, marginTop: 6 }}
                  >
                    <option value="admin">Console Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  style={{ ...primaryBtnStyle, marginTop: 8 }}
                >
                  {busy ? 'Creating...' : 'Create Console Admin'}
                </button>
              </form>
            )}

            {drawer.mode === 'manage' && selectedUser && (
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                <div
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    background: 'var(--surface-alt)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {selectedUser.email}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {selectedUser.displayName || 'No display name'}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--muted)',
                      marginTop: 4,
                    }}
                  >
                    Session v{selectedUser.tokenVersion} · Failed attempts:{' '}
                    {selectedUser.failedLoginAttempts} · Created{' '}
                    {formatTime(selectedUser.createdAt)}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                    }}
                  >
                    Console Access
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {selectedUser.consoleActive ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runUserAction(
                              {
                                action: 'grant_console_role',
                                userId: selectedUser.id,
                                consoleRole:
                                  selectedUser.consoleRole === 'super_admin'
                                    ? 'admin'
                                    : 'super_admin',
                              },
                              `Updated role for ${selectedUser.email}`,
                            )
                          }
                          style={secondaryBtnStyle}
                        >
                          {selectedUser.consoleRole === 'super_admin'
                            ? 'Set as Console Admin'
                            : 'Promote to Super Admin'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runUserAction(
                              {
                                action: 'revoke_console_role',
                                userId: selectedUser.id,
                              },
                              `Revoked console access for ${selectedUser.email}`,
                            )
                          }
                          style={{
                            ...secondaryBtnStyle,
                            color: 'var(--danger)',
                          }}
                        >
                          Revoke Console Access
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runUserAction(
                            {
                              action: 'grant_console_role',
                              userId: selectedUser.id,
                              consoleRole: 'admin',
                            },
                            `Granted console access to ${selectedUser.email}`,
                          )
                        }
                        style={primaryBtnStyle}
                      >
                        Grant Console Access
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    borderTop: '1px solid var(--border)',
                    paddingTop: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                    }}
                  >
                    Security & Sessions
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {selectedUser.lockedUntil != null &&
                      selectedUser.lockedUntil > Date.now() && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runUserAction(
                              {
                                action: 'unlock_user',
                                userId: selectedUser.id,
                              },
                              `Unlocked ${selectedUser.email}`,
                            )
                          }
                          style={secondaryBtnStyle}
                        >
                          Unlock Account
                        </button>
                      )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runUserAction(
                          {
                            action: 'revoke_tokens',
                            userId: selectedUser.id,
                          },
                          `Revoked all active sessions for ${selectedUser.email}`,
                        )
                      }
                      style={secondaryBtnStyle}
                    >
                      Revoke All Sessions
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 'auto',
                    borderTop: '1px solid var(--border)',
                    paddingTop: 14,
                  }}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete ${selectedUser.email}? This cannot be undone.`,
                        )
                      ) {
                        void runUserAction(
                          {
                            action: 'delete_user',
                            userId: selectedUser.id,
                          },
                          `Deleted ${selectedUser.email}`,
                          true,
                        );
                      }
                    }}
                    style={{
                      ...secondaryBtnStyle,
                      width: '100%',
                      color: 'var(--danger)',
                      borderColor: 'rgba(248, 113, 113, 0.35)',
                    }}
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
