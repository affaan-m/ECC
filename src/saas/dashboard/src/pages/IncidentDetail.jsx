import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useIncident } from '../hooks/useIncidents';
import { SevBadge, StatusBadge } from '../components/Badge';
import Timeline from '../components/Timeline';
import { fmtTime, fmtDuration, sevInfo } from '../lib/severity';

const s = {
  back: { color: '#8b949e', cursor: 'pointer', fontSize: 14, marginBottom: 20, display: 'inline-block' },
  header: { marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 },
  meta: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginTop: 24 },
  box: { background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20, marginBottom: 16 },
  boxTitle: { fontSize: 13, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase',
              letterSpacing: '0.05em', marginBottom: 14 },
  field: { marginBottom: 14 },
  label: { color: '#8b949e', fontSize: 12, marginBottom: 4 },
  value: { color: '#e2e8f0', fontSize: 14 },
  textarea: {
    width: '100%', background: '#0d1117', color: '#e2e8f0', border: '1px solid #30363d',
    borderRadius: 6, padding: '10px 12px', fontSize: 14, resize: 'vertical',
    minHeight: 80, fontFamily: 'inherit',
  },
  btn: (variant) => ({
    padding: '8px 16px', borderRadius: 6, fontSize: 14, cursor: 'pointer', border: 'none',
    background: variant === 'danger' ? '#7f1d1d' : variant === 'success' ? '#14532d' : '#1f6feb',
    color: '#e2e8f0', fontWeight: 600,
  }),
  btnRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  statusSelect: {
    background: '#0d1117', color: '#e2e8f0', border: '1px solid #30363d',
    padding: '8px 12px', borderRadius: 6, fontSize: 14,
  },
  sev_bar: (color) => ({
    height: 4, background: color, borderRadius: 2, marginBottom: 16,
  }),
  comment: { display: 'flex', gap: 10, marginTop: 16 },
  commentInput: {
    flex: 1, background: '#0d1117', color: '#e2e8f0', border: '1px solid #30363d',
    borderRadius: 6, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit',
  },
  loading: { color: '#8b949e', padding: '60px 0', textAlign: 'center' },
};

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { incident, events, loading, error, addComment, resolve, update } = useIncident(id);

  const [comment, setComment]   = useState('');
  const [status, setStatus]     = useState('');
  const [rootCause, setRootCause] = useState('');
  const [mitigation, setMitigation] = useState('');
  const [saving, setSaving]     = useState(false);

  if (loading) return <div style={s.loading}>Loading incident...</div>;
  if (error)   return <div style={{ color: '#ef4444', padding: 24 }}>Error: {error}</div>;
  if (!incident) return null;

  const sev = sevInfo(incident.severity);

  async function handleStatusUpdate() {
    setSaving(true);
    try {
      const fields = {};
      if (status) fields.status = status;
      if (rootCause) fields.root_cause = rootCause;
      if (mitigation) fields.mitigation = mitigation;
      if (Object.keys(fields).length) await update(fields);
    } finally { setSaving(false); }
  }

  async function handleComment() {
    if (!comment.trim()) return;
    await addComment(comment.trim());
    setComment('');
  }

  async function handleResolve() {
    if (!window.confirm('Mark this incident as resolved?')) return;
    await resolve();
  }

  return (
    <div>
      <div style={s.back} onClick={() => navigate(-1)}>← Back to Incidents</div>

      <div style={s.sev_bar(sev.color)} />

      <div style={s.header}>
        <h1 style={s.title}>{incident.title}</h1>
        <div style={s.meta}>
          <SevBadge level={incident.severity} />
          <StatusBadge status={incident.status} />
          <span style={{ color: '#8b949e', fontSize: 13 }}>Service: {incident.service}</span>
          <span style={{ color: '#8b949e', fontSize: 13 }}>Source: {incident.source_type || 'manual'}</span>
          <span style={{ color: '#8b949e', fontSize: 13 }}>Duration: {fmtDuration(incident.duration_secs)}</span>
        </div>
      </div>

      <div style={s.grid}>
        {/* Left column */}
        <div>
          {/* Summary */}
          {incident.summary && (
            <div style={s.box}>
              <div style={s.boxTitle}>Summary</div>
              <div style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.6 }}>{incident.summary}</div>
            </div>
          )}

          {/* Root Cause */}
          <div style={s.box}>
            <div style={s.boxTitle}>Root Cause</div>
            {incident.root_cause
              ? <div style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>{incident.root_cause}</div>
              : <div style={{ color: '#484f58', fontSize: 13, marginBottom: 12 }}>Not yet identified — add investigation findings below.</div>
            }
            <textarea
              style={s.textarea}
              placeholder="Document root cause..."
              value={rootCause}
              onChange={e => setRootCause(e.target.value)}
            />
          </div>

          {/* Mitigation */}
          <div style={s.box}>
            <div style={s.boxTitle}>Mitigation Applied</div>
            {incident.mitigation
              ? <div style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>{incident.mitigation}</div>
              : <div style={{ color: '#484f58', fontSize: 13, marginBottom: 12 }}>No mitigation recorded yet.</div>
            }
            <textarea
              style={s.textarea}
              placeholder="Document mitigation action..."
              value={mitigation}
              onChange={e => setMitigation(e.target.value)}
            />
          </div>

          {/* Update controls */}
          <div style={s.box}>
            <div style={s.boxTitle}>Update Incident</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                style={s.statusSelect}
                value={status}
                onChange={e => setStatus(e.target.value)}
              >
                <option value="">— Change Status —</option>
                <option value="investigating">Investigating</option>
                <option value="mitigating">Mitigating</option>
                <option value="resolved">Resolved</option>
              </select>
              <button style={s.btn('primary')} onClick={handleStatusUpdate} disabled={saving}>
                {saving ? 'Saving...' : 'Save Update'}
              </button>
              {incident.status !== 'resolved' && (
                <button style={s.btn('success')} onClick={handleResolve}>✓ Mark Resolved</button>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div style={s.box}>
            <div style={s.boxTitle}>Timeline</div>
            <Timeline events={events} />
            <div style={s.comment}>
              <textarea
                style={{ ...s.commentInput, minHeight: 60 }}
                placeholder="Add a comment or update..."
                value={comment}
                onChange={e => setComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleComment(); }}
              />
              <button style={s.btn('primary')} onClick={handleComment}>Post</button>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div>
          <div style={s.box}>
            <div style={s.boxTitle}>Details</div>
            {[
              ['ID',        incident.id?.slice(0, 8) + '...'],
              ['Created',   fmtTime(incident.created_at)],
              ['Updated',   fmtTime(incident.updated_at)],
              ['Resolved',  fmtTime(incident.resolved_at)],
              ['Duration',  fmtDuration(incident.duration_secs)],
              ['Source',    incident.source_type || 'manual'],
            ].map(([label, value]) => (
              <div key={label} style={s.field}>
                <div style={s.label}>{label}</div>
                <div style={s.value}>{value}</div>
              </div>
            ))}
          </div>

          {incident.postmortem_id && (
            <div style={s.box}>
              <div style={s.boxTitle}>Postmortem</div>
              <StatusBadge status={incident.postmortem_status} />
              <div style={{ marginTop: 12 }}>
                <button style={s.btn('primary')} onClick={() => navigate(`/postmortems/${incident.postmortem_id}`)}>
                  View Postmortem →
                </button>
              </div>
            </div>
          )}

          {incident.status === 'resolved' && !incident.postmortem_id && (
            <div style={s.box}>
              <div style={s.boxTitle}>Postmortem</div>
              <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 12 }}>
                Incident resolved. Generate a blameless postmortem?
              </div>
              <button style={s.btn('primary')}>Generate Postmortem</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
