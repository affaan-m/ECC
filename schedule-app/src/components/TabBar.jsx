import { NavLink } from 'react-router-dom';
import { tapTick } from '../data/haptics.js';

const TABS = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/goals', label: 'Goals', icon: TargetIcon },
  { to: '/planner', label: 'Planner', icon: CalendarIcon },
  { to: '/contacts', label: 'People', icon: PeopleIcon },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/more', label: 'More', icon: MoreIcon },
];

export default function TabBar() {
  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={tapTick}
          aria-label={label}
          title={label}
          className={({ isActive }) => `tab${isActive ? ' tab--active' : ''}`}
        >
          <Icon />
        </NavLink>
      ))}
    </nav>
  );
}

/* Inline SVG icons keep the app fully self-contained (no icon dependency). */
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3 9h18M8 3v3M16 3v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 6.2A3 3 0 0 1 16 12M17 14.2c2.4.5 4 2.4 4 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d="M12 21s6.5-5.2 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.8 12 21 12 21z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="10.6" r="2.4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}
