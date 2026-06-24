const s = {
  bar: { display: 'flex', gap: 16, marginBottom: 28 },
  card: (color) => ({
    flex: 1, background: '#161b22', border: `1px solid ${color}30`,
    borderRadius: 8, padding: '16px 20px',
  }),
  label: { color: '#8b949e', fontSize: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' },
  value: (color) => ({ color, fontSize: 28, fontWeight: 700 }),
};

export default function StatsBar({ incidents }) {
  const open  = incidents.filter(i => i.status !== 'resolved');
  const sev1  = open.filter(i => i.severity === 1).length;
  const sev2  = open.filter(i => i.severity === 2).length;
  const total = open.length;
  const resolved = incidents.filter(i => i.status === 'resolved').length;

  return (
    <div style={s.bar}>
      <div style={s.card('#ef4444')}>
        <div style={s.label}>SEV1 Open</div>
        <div style={s.value('#ef4444')}>{sev1}</div>
      </div>
      <div style={s.card('#f97316')}>
        <div style={s.label}>SEV2 Open</div>
        <div style={s.value('#f97316')}>{sev2}</div>
      </div>
      <div style={s.card('#eab308')}>
        <div style={s.label}>All Open</div>
        <div style={s.value('#eab308')}>{total}</div>
      </div>
      <div style={s.card('#22c55e')}>
        <div style={s.label}>Resolved (page)</div>
        <div style={s.value('#22c55e')}>{resolved}</div>
      </div>
    </div>
  );
}
