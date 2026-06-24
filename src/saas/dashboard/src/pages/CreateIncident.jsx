import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const s = {
  title: { fontSize: 22, fontWeight: 700, color: '#e2e8f0', marginBottom: 24 },
  box: { background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 24, maxWidth: 600 },
  field: { marginBottom: 18 },
  label: { display: 'block', color: '#8b949e', fontSize: 13, marginBottom: 6, fontWeight: 600 },
  input: {
    width: '100%', background: '#0d1117', color: '#e2e8f0', border: '1px solid #30363d',
    padding: '10px 12px', borderRadius: 6, fontSize: 14, fontFamily: 'inherit',
  },
  select: {
    width: '100%', background: '#0d1117', color: '#e2e8f0', border: '1px solid #30363d',
    padding: '10px 12px', borderRadius: 6, fontSize: 14, cursor: 'pointer',
  },
  textarea: {
    width: '100%', background: '#0d1117', color: '#e2e8f0', border: '1px solid #30363d',
    padding: '10px 12px', borderRadius: 6, fontSize: 14, fontFamily: 'inherit',
    resize: 'vertical', minHeight: 100,
  },
  btn: { background: '#1f6feb', color: '#e2e8f0', border: 'none', padding: '10px 24px',
         borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  err: { color: '#ef4444', marginBottom: 16, fontSize: 14 },
};

export default function CreateIncident() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', service: '', severity: '3', summary: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.service.trim()) {
      setError('Title and service are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const inc = await api.post('/incidents', {
        title:    form.title.trim(),
        service:  form.service.trim(),
        severity: parseInt(form.severity, 10),
        summary:  form.summary.trim(),
      });
      navigate(`/incidents/${inc.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 style={s.title}>Create Incident</h1>
      <div style={s.box}>
        {error && <div style={s.err}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={s.field}>
            <label style={s.label}>Title *</label>
            <input style={s.input} value={form.title} onChange={set('title')}
                   placeholder="e.g. Payments API — Error rate 8% on POST /checkout" />
          </div>
          <div style={s.field}>
            <label style={s.label}>Service *</label>
            <input style={s.input} value={form.service} onChange={set('service')}
                   placeholder="e.g. payments-api" />
          </div>
          <div style={s.field}>
            <label style={s.label}>Severity</label>
            <select style={s.select} value={form.severity} onChange={set('severity')}>
              <option value="1">SEV1 — Critical (full outage, data loss risk)</option>
              <option value="2">SEV2 — High (major feature broken)</option>
              <option value="3">SEV3 — Medium (minor feature, workaround exists)</option>
              <option value="4">SEV4 — Low (cosmetic / logging)</option>
            </select>
          </div>
          <div style={s.field}>
            <label style={s.label}>Summary</label>
            <textarea style={s.textarea} value={form.summary} onChange={set('summary')}
                      placeholder="Describe what's happening..." />
          </div>
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Creating...' : '🚨 Create Incident'}
          </button>
        </form>
      </div>
    </div>
  );
}
