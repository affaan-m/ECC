import { useState } from 'react';
import { useIncidents } from '../hooks/useIncidents';
import IncidentTable from '../components/IncidentTable';
import StatsBar from '../components/StatsBar';

const s = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#e2e8f0' },
  filters: { display: 'flex', gap: 10, marginBottom: 20 },
  select: {
    background: '#161b22', color: '#e2e8f0', border: '1px solid #30363d',
    padding: '8px 12px', borderRadius: 6, fontSize: 14, cursor: 'pointer',
  },
  input: {
    background: '#161b22', color: '#e2e8f0', border: '1px solid #30363d',
    padding: '8px 12px', borderRadius: 6, fontSize: 14, width: 200,
  },
  box: { background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20 },
  pager: { display: 'flex', gap: 12, alignItems: 'center', marginTop: 20, justifyContent: 'flex-end' },
  btn: (disabled) => ({
    background: disabled ? '#21262d' : '#1f6feb', color: disabled ? '#484f58' : '#e2e8f0',
    border: 'none', padding: '8px 16px', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
    fontSize: 14,
  }),
  pageInfo: { color: '#8b949e', fontSize: 14 },
};

const PAGE = 25;

export default function IncidentList() {
  const [status, setStatus]   = useState('');
  const [severity, setSev]    = useState('');
  const [service, setService] = useState('');
  const [page, setPage]       = useState(0);

  const { incidents, total, loading, error } = useIncidents({
    status, severity, service, limit: PAGE, offset: page * PAGE,
  });

  const totalPages = Math.ceil(total / PAGE);

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>Incidents</h1>
        <div style={{ color: '#8b949e', fontSize: 14 }}>Auto-refreshes every 30s</div>
      </div>

      <StatsBar incidents={incidents} />

      <div style={s.filters}>
        <select style={s.select} value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}>
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="mitigating">Mitigating</option>
          <option value="resolved">Resolved</option>
        </select>
        <select style={s.select} value={severity} onChange={e => { setSev(e.target.value); setPage(0); }}>
          <option value="">All Severities</option>
          <option value="1">SEV1 - Critical</option>
          <option value="2">SEV2 - High</option>
          <option value="3">SEV3 - Medium</option>
          <option value="4">SEV4 - Low</option>
        </select>
        <input
          style={s.input}
          placeholder="Filter by service..."
          value={service}
          onChange={e => { setService(e.target.value); setPage(0); }}
        />
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 16 }}>Error: {error}</div>}

      <div style={s.box}>
        <IncidentTable incidents={incidents} loading={loading} />
      </div>

      {totalPages > 1 && (
        <div style={s.pager}>
          <button style={s.btn(page === 0)} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span style={s.pageInfo}>Page {page + 1} of {totalPages} ({total} total)</span>
          <button style={s.btn(page >= totalPages - 1)} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
