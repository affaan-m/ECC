import { sevInfo, STATUS_COLOR } from '../lib/severity';

export function SevBadge({ level }) {
  const s = sevInfo(level);
  return (
    <span style={{
      background: s.badge, color: s.color,
      padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700,
      letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

export function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || '#6b7280';
  return (
    <span style={{
      color, border: `1px solid ${color}`,
      padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
      textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  );
}
