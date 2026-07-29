import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DemoSky from '../components/DemoSky.jsx';
import { InfoIcon } from '../components/Icons.jsx';
import Mark from '../components/Mark.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(username, password);
      navigate('/home', { replace: true });
    } catch (err) {
      setError({ message: err.message, field: err.field });
    } finally {
      setBusy(false);
    }
  };

  const errFor = (field) => (error && (error.field === field || !error.field) ? error : null);

  return (
    <div className="page auth">
      <div className="auth-sky">
        <DemoSky showLabels={false} dim />
      </div>
      <div className="auth-veil" />

      <div className="auth-inner">
        <Mark size={14} glow={12} />
        <h1>Make yourself a sky</h1>
        <p>Pick a name only you need to remember. There's no email, no reset link, nothing to verify.</p>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className={`input${errFor('username') ? ' is-error' : ''}`}
              style={{ minHeight: 40 }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
            {errFor('username') ? (
              <div className="field-error">
                <InfoIcon size={13} color="currentColor" />
                {errFor('username').message}
              </div>
            ) : (
              <div className="hint">3–32 characters · letters, numbers, dash, underscore</div>
            )}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className={`input${error?.field === 'password' ? ' is-error' : ''}`}
              style={{ minHeight: 40, letterSpacing: password ? '.22em' : 'normal' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            {error?.field === 'password' ? (
              <div className="field-error">
                <InfoIcon size={13} color="currentColor" />
                {error.message}
              </div>
            ) : (
              <div className="hint">At least 8 characters</div>
            )}
          </div>

          <button className="btn btn-primary btn-block" style={{ minHeight: 42, marginTop: 8 }} disabled={busy}>
            {busy ? 'Making it…' : 'Create my brain'}
          </button>
          <div className="swap">
            Been here before? <Link to="/login">Log in</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
