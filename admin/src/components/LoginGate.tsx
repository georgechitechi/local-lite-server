import { useEffect, useState } from 'react';
import { PasswordInput } from '@/components/PasswordInput';
import { buildApiUrl } from '@/lib/api';
import {
  inputStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
} from '@/styles/adminStyles';

type ViewMode = 'login' | 'signup' | 'forgot' | 'reset' | 'bootstrap';

const linkBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: 'var(--muted)',
  fontSize: 12.5,
  cursor: 'pointer',
  textDecoration: 'underline',
};

export function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [view, setView] = useState<ViewMode>('login');
  const [hasConsoleAdmins, setHasConsoleAdmins] = useState<boolean | null>(
    null,
  );
  const [allowConsoleSignup, setAllowConsoleSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [secretInput, setSecretInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(buildApiUrl('/admin/login'));
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as {
          hasConsoleAdmins?: boolean;
          allowConsoleSignup?: boolean;
        };
        if (typeof data.hasConsoleAdmins === 'boolean') {
          setHasConsoleAdmins(data.hasConsoleAdmins);
        }
        if (typeof data.allowConsoleSignup === 'boolean') {
          setAllowConsoleSignup(data.allowConsoleSignup);
        }
      } catch {
        // Ignore probe error
      }
    })();
  }, []);

  const switchView = (next: ViewMode) => {
    setError(null);
    setNotice(null);
    setView(next);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const payload =
        view === 'bootstrap'
          ? { action: 'bootstrap', secret: secretInput, email, password }
          : view === 'signup'
            ? { action: 'signup', email, password, displayName }
            : { email, password };
      const res = await fetch(buildApiUrl('/admin/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error || 'Invalid email or password.');
        return;
      }
      setPassword('');
      setSecretInput('');
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Could not reach server.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl('/auth/local/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || 'Could not send reset code.');
        return;
      }
      setNotice(
        data.message || 'Check your email for the 6-digit verification code.',
      );
      setView('reset');
    } catch (err: any) {
      setError(err?.message || 'Could not reach server.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl('/auth/local/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, newPassword: password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || 'Could not reset password.');
        return;
      }
      setOtp('');
      setPassword('');
      setView('login');
      setNotice('Password updated. Sign in with your new password.');
    } catch (err: any) {
      setError(err?.message || 'Could not reach server.');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit =
    view === 'forgot'
      ? handleForgot
      : view === 'reset'
        ? handleReset
        : handleLogin;

  const heading =
    view === 'forgot'
      ? 'Reset Password'
      : view === 'reset'
        ? 'Enter Verification Code'
        : view === 'bootstrap'
          ? 'First-Time Setup'
          : view === 'signup'
            ? 'Create Account'
            : 'Server Console';

  const subtitle =
    view === 'forgot'
      ? 'Enter your admin email to receive a 6-digit reset code.'
      : view === 'reset'
        ? 'Enter the 6-digit code sent to your email and choose a new password.'
        : view === 'bootstrap'
          ? 'Create your first admin account using your server APP_SECRET.'
          : view === 'signup'
            ? 'Create an account to launch and manage your own projects.'
            : 'Sign in with your admin email and password.';

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: '100%',
          maxWidth: 400,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--accent)',
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            local-lite-server
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
            {heading}
          </h1>
          <p
            style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--muted)' }}
          >
            {subtitle}
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--danger-soft)',
              border: '1px solid rgba(248, 113, 113, 0.35)',
              color: 'var(--danger)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(52, 211, 153, 0.12)',
              border: '1px solid rgba(52, 211, 153, 0.35)',
              color: 'var(--success)',
              fontSize: 13,
            }}
          >
            {notice}
          </div>
        )}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          style={inputStyle}
        />

        {view === 'reset' && (
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            required
            style={inputStyle}
          />
        )}

        {view === 'signup' && (
          <input
            type="text"
            placeholder="Name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={inputStyle}
          />
        )}

        {(view === 'login' || view === 'signup' || view === 'reset' || view === 'bootstrap') && (
          <PasswordInput
            placeholder={view === 'reset' ? 'New password' : 'Password'}
            value={password}
            onChange={setPassword}
            required
            autoComplete={
              view === 'login' ? 'current-password' : 'new-password'
            }
          />
        )}

        {view === 'bootstrap' && (
          <PasswordInput
            placeholder="APP_SECRET"
            value={secretInput}
            onChange={setSecretInput}
            required
          />
        )}

        <button type="submit" disabled={loading} style={primaryBtnStyle}>
          {loading
            ? 'Please wait...'
            : view === 'forgot'
              ? 'Send Reset Code'
              : view === 'reset'
                ? 'Reset Password'
                : view === 'bootstrap'
                  ? 'Create Admin & Sign In'
                  : view === 'signup'
                    ? 'Create Account'
                    : 'Sign In'}
        </button>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            paddingTop: 2,
          }}
        >
          {view === 'login' ? (
            <>
              <button
                type="button"
                onClick={() => switchView('forgot')}
                style={linkBtnStyle}
              >
                Forgot password?
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                {allowConsoleSignup && (
                  <button
                    type="button"
                    onClick={() => switchView('signup')}
                    style={linkBtnStyle}
                  >
                    Create account
                  </button>
                )}
                {hasConsoleAdmins === false && (
                  <button
                    type="button"
                    onClick={() => switchView('bootstrap')}
                    style={linkBtnStyle}
                  >
                    First-time setup
                  </button>
                )}
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => switchView('login')}
              style={{ ...secondaryBtnStyle, fontSize: 12 }}
            >
              Back to Sign In
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
