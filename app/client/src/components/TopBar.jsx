import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import Mark from './Mark.jsx';

/** The header on the reading screens. */
export default function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const signOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <header className="topbar">
      <Mark to="/home" size={13} glow={11} />
      <NavLink to="/home" className={({ isActive }) => (isActive ? 'is-current' : '')}>
        Add
      </NavLink>
      <NavLink to="/sky" className={({ isActive }) => (isActive ? 'is-current' : '')}>
        Your sky
      </NavLink>
      <button className="avatar" onClick={signOut} title={`Signed in as ${user?.username} — log out`}>
        {(user?.username ?? '?').slice(0, 1)}
      </button>
    </header>
  );
}
