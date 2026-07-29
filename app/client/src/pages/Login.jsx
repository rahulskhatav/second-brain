import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import DemoSky from '../components/DemoSky.jsx';
import { InfoIcon } from '../components/Icons.jsx';
import Mark from '../components/Mark.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      navigate(location.state?.from ?? '/sky', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page auth">
      <div className="auth-sky">
        <DemoSky showLabels={false} dim />
      </div>
      <div className="auth-veil" />

      <div className="auth-inner">
        <Mark size={14} glow={12} />
        <h1>Welcome back</h1>
        <p>Everything is where you left it — same positions, same clusters.</p>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              style={{ minHeight: 40 }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className={`input${error ? ' is-error' : ''}`}
              style={{ minHeight: 40, letterSpacing: password ? '.22em' : 'normal' }}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && (
              <div className="field-error">
                <InfoIcon size={13} color="currentColor" />
                {error}
              </div>
            )}
          </div>

          <button className="btn btn-primary btn-block" style={{ minHeight: 42, marginTop: 8 }} disabled={busy}>
            {busy ? 'Looking…' : 'Log in'}
          </button>
          <div className="swap">
            No brain yet? <Link to="/register">Make one</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
