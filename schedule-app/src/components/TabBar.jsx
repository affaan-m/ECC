import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../data/store.jsx';
import { TAB_TYPES, normalizeTabOrder } from '../data/tabs.js';
import Icon from './Icon.jsx';

// These grew up here, and the rest of the app's icons were later drawn to
// match them. Now that there's a shared set, the tab bar uses it too rather
// than keeping a second copy of the same six drawings.
const ICONS = {
  home: 'home',
  goals: 'target',
  planner: 'calendar',
  contacts: 'users',
  map: 'pin',
  more: 'more',
};

export default function TabBar() {
  const { state } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  // Reordering/hiding tabs is Pro-gated — a lapsed subscriber just falls
  // back to the full default set rather than being left with a broken bar.
  const isPro = !!state.settings?.isPro;
  const order = isPro ? normalizeTabOrder(state.settings?.tabOrder) : TAB_TYPES.map((t) => ({ id: t.id, enabled: true }));
  const visible = order.filter((o) => o.enabled).map((o) => TAB_TYPES.find((t) => t.id === o.id)).filter(Boolean);

  return (
    <nav className="tabbar" aria-label="Primary">
      {visible.map(({ id, to, label }) => {
        const iconName = ICONS[id];
        return (
          <NavLink
            key={to}
            to={to}
            end={id === 'home'}
            aria-label={label}
            title={label}
            className={({ isActive }) => `tab${isActive ? ' tab--active' : ''}`}
            onClick={(e) => {
              // Tapping the Planner tab when Planner is already showing is
              // otherwise a no-op — React Router sees the same path and
              // doesn't re-render. Treat it as "take me back to now",
              // matching what every other calendar app does.
              if (id === 'planner' && location.pathname === to) {
                e.preventDefault();
                navigate(to, { state: { jumpToNow: true } });
              }
            }}
          >
            <Icon name={iconName} size={24} />
          </NavLink>
        );
      })}
    </nav>
  );
}
