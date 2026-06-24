import { fmtTime } from '../lib/severity';

const EVENT_ICON = {
  alert_received:     '📡',
  triage:             '🔍',
  diagnosis:          '🧠',
  mitigation:         '🔧',
  status_change:      '📋',
  notification_sent:  '📣',
  postmortem:         '📄',
  comment:            '💬',
};

const s = {
  list: { listStyle: 'none', position: 'relative' },
  item: { display: 'flex', gap: 12, marginBottom: 20 },
  icon: {
    width: 32, height: 32, borderRadius: '50%',
    background: '#21262d', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 14, flexShrink: 0,
  },
  body: { flex: 1 },
  meta: { color: '#8b949e', fontSize: 12, marginBottom: 4 },
  msg: { color: '#e2e8f0', fontSize: 14, lineHeight: 1.5 },
  empty: { color: '#8b949e', textAlign: 'center', padding: '24px 0' },
};

export default function Timeline({ events }) {
  if (!events.length) return <div style={s.empty}>No timeline events yet.</div>;

  return (
    <ul style={s.list}>
      {events.map(ev => (
        <li key={ev.id} style={s.item}>
          <div style={s.icon}>{EVENT_ICON[ev.event_type] || '•'}</div>
          <div style={s.body}>
            <div style={s.meta}>{ev.actor} · {fmtTime(ev.created_at)}</div>
            <div style={s.msg}>{ev.message}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
