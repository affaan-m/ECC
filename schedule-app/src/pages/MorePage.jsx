import { useRef, useState } from 'react';
import { useStore, useActions } from '../data/store.jsx';
import Modal from '../components/Modal.jsx';

const PRESET_COLORS = [
  '#2e9e6b',
  '#1f5f8b',
  '#e08a1e',
  '#8a5cd1',
  '#d1495b',
  '#3a9188',
  '#c2547a',
  '#5b7fb0',
];

export default function MorePage() {
  const { state } = useStore();
  const actions = useActions();
  const [editingStatus, setEditingStatus] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'reset' | 'clear' | null
  const fileRef = useRef(null);

  const theme = state.settings?.theme || 'system';

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compass-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        actions.importData(data);
      } catch {
        alert('That file could not be read as a Compass backup.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const saveStatus = () => {
    const label = editingStatus.label.trim();
    if (!label) return;
    if (editingStatus.id) actions.updateStatus({ id: editingStatus.id, label, color: editingStatus.color });
    else actions.addStatus({ label, color: editingStatus.color });
    setEditingStatus(null);
  };

  const counts = {
    goals: state.goals.length,
    events: state.events.length,
    contacts: state.contacts.length,
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <h1>More</h1>
        </div>
      </header>

      <section className="detail-section">
        <span className="detail-label">Appearance</span>
        <div className="seg seg--full">
          {['system', 'light', 'dark'].map((t) => (
            <button
              key={t}
              className={`seg-btn${theme === t ? ' seg-btn--on' : ''}`}
              onClick={() => actions.setSettings({ theme: t })}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <span className="detail-label">Reconnect reminders</span>
        <p className="muted small">
          Flag people on the People tab when you haven't been in touch for this long.
          You can override it per person.
        </p>
        <div className="cadence-setting">
          <button
            className="step-btn"
            onClick={() =>
              actions.setSettings({ reconnectDays: Math.max(1, (state.settings?.reconnectDays ?? 30) - 5) })
            }
            aria-label="Fewer days"
          >
            −
          </button>
          <span className="cadence-value">
            <strong>{state.settings?.reconnectDays ?? 30}</strong> days
          </span>
          <button
            className="step-btn step-btn--plus"
            onClick={() =>
              actions.setSettings({ reconnectDays: Math.min(365, (state.settings?.reconnectDays ?? 30) + 5) })
            }
            aria-label="More days"
          >
            +
          </button>
        </div>
      </section>

      <section className="detail-section">
        <div className="section-head">
          <span className="detail-label">People statuses</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setEditingStatus({ label: '', color: PRESET_COLORS[0] })}
          >
            + Add
          </button>
        </div>
        <p className="muted small">Custom labels you assign to people on the People tab.</p>
        <ul className="status-list">
          {state.statuses.map((s) => (
            <li key={s.id}>
              <button className="status-item" onClick={() => setEditingStatus({ ...s })}>
                <span className="swatch" style={{ background: s.color }} />
                <span>{s.label}</span>
                <span className="muted count-tag">
                  {state.contacts.filter((c) => c.statusId === s.id).length}
                </span>
              </button>
            </li>
          ))}
          {state.statuses.length === 0 && <li className="muted small">No statuses yet.</li>}
        </ul>
      </section>

      <section className="detail-section">
        <span className="detail-label">Your data</span>
        <p className="muted small">
          Everything is stored privately on this device. {counts.goals} goals · {counts.events} events ·{' '}
          {counts.contacts} people.
        </p>
        <div className="stack-btns">
          <button className="btn btn-ghost full" onClick={exportData}>
            Export backup (.json)
          </button>
          <button className="btn btn-ghost full" onClick={() => fileRef.current?.click()}>
            Import backup
          </button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={importData} />
          <button className="btn btn-ghost full" onClick={() => setConfirm('reset')}>
            Reset to sample data
          </button>
          <button className="btn btn-danger-ghost full" onClick={() => setConfirm('clear')}>
            Clear everything
          </button>
        </div>
      </section>

      <p className="muted small center-pad">Compass · works offline · v0.1</p>

      {/* Status editor */}
      <Modal
        open={!!editingStatus}
        title={editingStatus?.id ? 'Edit status' : 'New status'}
        onClose={() => setEditingStatus(null)}
        footer={
          <div className="modal-actions">
            {editingStatus?.id && (
              <button
                className="btn btn-danger-ghost"
                onClick={() => {
                  actions.deleteStatus(editingStatus.id);
                  setEditingStatus(null);
                }}
              >
                Delete
              </button>
            )}
            <button className="btn btn-primary" onClick={saveStatus}>
              Save
            </button>
          </div>
        }
      >
        {editingStatus && (
          <div className="form">
            <label className="field">
              <span>Label</span>
              <input
                autoFocus
                value={editingStatus.label}
                onChange={(e) => setEditingStatus({ ...editingStatus, label: e.target.value })}
                placeholder="e.g. Close, Reconnect"
              />
            </label>
            <div className="field">
              <span>Color</span>
              <div className="color-grid">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`color-dot${editingStatus.color === c ? ' color-dot--on' : ''}`}
                    style={{ background: c }}
                    onClick={() => setEditingStatus({ ...editingStatus, color: c })}
                    aria-label={`Choose ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm reset / clear */}
      <Modal
        open={!!confirm}
        title={confirm === 'reset' ? 'Reset to sample data?' : 'Clear everything?'}
        onClose={() => setConfirm(null)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                if (confirm === 'reset') actions.resetData();
                else actions.clearData();
                setConfirm(null);
              }}
            >
              {confirm === 'reset' ? 'Reset' : 'Clear'}
            </button>
          </div>
        }
      >
        <p>
          {confirm === 'reset'
            ? 'This replaces your current data with the built-in sample set.'
            : 'This permanently removes all goals, events, and people. Your custom statuses are kept.'}
        </p>
      </Modal>
    </div>
  );
}
