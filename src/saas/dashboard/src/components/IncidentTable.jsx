import { useNavigate } from 'react-router-dom';
import { SevBadge, StatusBadge } from './Badge';
import { fmtTimeAgo, fmtDuration } from '../lib/severity';

const s = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 12px', color: '#8b949e', fontWeight: 600,
        fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em',
        borderBottom: '1px solid #21262d' },
  tr: (hover) => ({
    borderBottom: '1px solid #21262d',
    cursor: 'pointer',
    background: hover ? '#161b22' : 'transparent',
    transition: 'background 0.1s',
  }),
  td: { padding: '12px 12px', verticalAlign: 'middle' },
  title: { color: '#e2e8f0', fontWeight: 500, marginBottom: 2 },
  service: { color: '#8b949e', fontSize: 12 },
  empty: { textAlign: 'center', padding: '60px 0', color: '#8b949e' },
};

export default function IncidentTable({ incidents, loading }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(null);

  if (loading) return <div style={s.empty}>Loading incidents...</div>;
  if (!incidents.length) return <div style={s.empty}>No incidents found</div>;

  return (
    <table style={s.table}>
      <thead>
        <tr>
          <th style={s.th}>Severity</th>
          <th style={s.th}>Incident</th>
          <th style={s.th}>Status</th>
          <th style={s.th}>Source</th>
          <th style={s.th}>Duration</th>
          <th style={s.th}>Started</th>
        </tr>
      </thead>
      <tbody>
        {incidents.map(inc => (
          <tr
            key={inc.id}
            style={s.tr(hovered === inc.id)}
            onClick={() => navigate(`/incidents/${inc.id}`)}
            onMouseEnter={() => setHovered(inc.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <td style={s.td}><SevBadge level={inc.severity} /></td>
            <td style={s.td}>
              <div style={s.title}>{inc.title}</div>
              <div style={s.service}>{inc.service}</div>
            </td>
            <td style={s.td}><StatusBadge status={inc.status} /></td>
            <td style={{ ...s.td, color: '#8b949e' }}>{inc.source_type || '—'}</td>
            <td style={{ ...s.td, color: '#8b949e' }}>{fmtDuration(inc.duration_secs)}</td>
            <td style={{ ...s.td, color: '#8b949e' }}>{fmtTimeAgo(inc.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// useState import hoisted
import { useState } from 'react';
