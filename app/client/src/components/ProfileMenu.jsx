import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { SignOutIcon } from './Icons.jsx';

/**
 * The avatar, and what sits under it.
 *
 * It used to sign you out on a single click, which is a lot to happen by
 * accident from a button showing one letter. Now it opens.
 */
export default function ProfileMenu({ className = 'avatar' }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const signOut = async () => {
    setOpen(false);
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="profile" ref={wrapRef}>
      <button
        className={className}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Signed in as ${user?.username ?? ''}`}
      >
        {(user?.username ?? '?').slice(0, 1)}
      </button>

      {open && (
        <div className="profile-menu glass" role="menu">
          <div className="profile-who">
            <div className="kicker-quiet">Signed in as</div>
            <div className="profile-name">{user?.username}</div>
          </div>
          <hr className="fade-rule" />
          <button className="profile-item" role="menuitem" onClick={signOut}>
            <SignOutIcon />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
