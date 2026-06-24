import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/',          label: '⚡ Incidents' },
  { to: '/create',    label: '+ New Incident' },
];

const style = {
  shell: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 220, background: '#161b22', borderRight: '1px solid #21262d',
    display: 'flex', flexDirection: 'column', padding: '24px 0',
  },
  brand: { color: '#f97316', fontWeight: 800, fontSize: 18, padding: '0 20px 24px' },
  nav: { flex: 1 },
  link: (active) => ({
    display: 'block', padding: '10px 20px',
    color: active ? '#f97316' : '#8b949e', textDecoration: 'none',
    background: active ? '#1f2937' : 'transparent', fontWeight: active ? 600 : 400,
    borderLeft: active ? '3px solid #f97316' : '3px solid transparent',
    fontSize: 14,
  }),
  main: { flex: 1, padding: '32px', overflowY: 'auto' },
  footer: { padding: '16px 20px', color: '#484f58', fontSize: 12 },
};

export default function Layout({ children }) {
  return (
    <div style={style.shell}>
      <aside style={style.sidebar}>
        <div style={style.brand}>🚨 IRA</div>
        <nav style={style.nav}>
          {NAV.map(({ to, label }) => (
            <NavLink key={to} to={to} end style={({ isActive }) => style.link(isActive)}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div style={style.footer}>Incident Response SaaS</div>
      </aside>
      <main style={style.main}>{children}</main>
    </div>
  );
}
