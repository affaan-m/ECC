import { useEffect, useRef, useState } from 'react';
import Select from './Select.jsx';
import Modal from './Modal.jsx';
import { useStore, useActions } from '../data/store.jsx';

const NEW = '__new_group__';

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

// The group dropdown on a person, with "New group…" built into the list.
//
// Groups previously had to exist before you could use one: you'd be halfway
// through adding someone, realise they belong to a group you haven't made,
// then have to abandon the form, go to Settings, create it and come back.
// The moment you want a group is the moment you're filing somebody, so
// that's where you can make one.
//
// The stored field is still `statusId` — this is a rename of what the user
// sees, not a data migration, so existing records and the per-person colour
// that keys off them keep working untouched.
export default function GroupPicker({ value, onChange }) {
  const { state } = useStore();
  const actions = useActions();
  const [draft, setDraft] = useState(null); // { label, color } | null

  // addStatus mints the id inside the reducer, so the new group's id isn't
  // known when we ask for it. Remember what we asked for and select it on
  // the render that first contains it — otherwise creating a group would
  // leave the field still empty, which reads as the action having failed.
  const awaiting = useRef(null);
  useEffect(() => {
    if (!awaiting.current) return;
    const made = state.statuses.find((s) => s.label === awaiting.current);
    if (made) {
      awaiting.current = null;
      onChange(made.id);
    }
  }, [state.statuses, onChange]);

  const options = [
    { value: '', label: 'No group' },
    ...state.statuses.map((s) => ({ value: s.id, label: s.label, color: s.color })),
    { value: NEW, label: '+ New group…' },
  ];

  const openNew = () => {
    // Offer a colour nothing else is using, so a new group is
    // distinguishable at a glance instead of matching an existing one.
    const used = new Set(state.statuses.map((s) => s.color));
    setDraft({ label: '', color: PRESET_COLORS.find((c) => !used.has(c)) || PRESET_COLORS[0] });
  };

  const create = () => {
    const label = draft.label.trim();
    if (!label) return;
    awaiting.current = label;
    actions.addStatus({ label, color: draft.color });
    setDraft(null);
  };

  return (
    <>
      <Select
        value={value || ''}
        onChange={(v) => (v === NEW ? openNew() : onChange(v))}
        options={options}
      />
      <Modal
        open={!!draft}
        title="New group"
        onClose={() => setDraft(null)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={create} disabled={!draft?.label.trim()}>
              Create
            </button>
          </div>
        }
      >
        {draft && (
          <div className="form">
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="e.g. Family, Team, Neighbours"
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
            </label>
            <div className="field">
              <span>Color</span>
              <div className="color-grid">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-dot${draft.color === c ? ' color-dot--on' : ''}`}
                    style={{ background: c }}
                    onClick={() => setDraft({ ...draft, color: c })}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
