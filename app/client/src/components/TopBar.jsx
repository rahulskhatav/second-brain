import { NavLink } from 'react-router-dom';
import Mark from './Mark.jsx';
import ProfileMenu from './ProfileMenu.jsx';

/** The header on the reading screens. */
export default function TopBar() {
  return (
    <header className="topbar">
      <Mark to="/home" size={13} glow={11} />
      <NavLink to="/home" className={({ isActive }) => (isActive ? 'is-current' : '')}>
        Add
      </NavLink>
      <NavLink to="/sky" className={({ isActive }) => (isActive ? 'is-current' : '')}>
        Your sky
      </NavLink>
      <ProfileMenu />
    </header>
  );
}
