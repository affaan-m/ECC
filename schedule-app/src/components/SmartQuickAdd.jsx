import { useState } from 'react';
import Modal from './Modal.jsx';
import { parseQuickAdd } from '../data/smartParse.js';
import { formatShortDate, formatTime } from '../data/helpers.js';

// Pro quick-add: type free text like "call mom fri 3pm" and it's parsed
// (offline, no API call — see data/smartParse.js) into a title plus an
// optional date/time, previewed live, with a Task/Event toggle defaulting
// to whichever the parse implies (a time found means Event, otherwise Task)
// but always overridable before adding.
export default function SmartQuickAdd({ open, onClose, onCreate }) {
  const [text, setText] = useState('');
  const [kindOverride, setKindOverride] = useState(null);

  const parsed = text.trim() ? parseQuickAdd(text) : null;
  const autoKind = parsed?.time ? 'event' : 'task';
  const kind = kindOverride || autoKind;

  const reset = () => {
    setText('');
    setKindOverride(null);
  };
  const close = () => {
    onClose();
    reset();
  };
  const submit = () => {
    if (!parsed?.title.trim()) return;
    onCreate(kind, parsed);
    reset();
  };

  return (
    <Modal
      open={open}
      title="✨ Smart add"
      onClose={close}
      footer={
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!parsed?.title.trim()}>
            Add
          </button>
        </div>
      }
    >
      <div className="form">
        <label className="field">
          <span>Type anything</span>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='e.g. "call mom fri 3pm"'
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        {parsed && (
          <>
            <div className="smart-preview">
              <strong>{parsed.title || '…'}</strong>
              <span className="muted small">
                {parsed.date ? formatShortDate(parsed.date) : 'No date'}
                {parsed.time ? ` · ${formatTime(parsed.time)}` : ''}
                {parsed.endTime ? `–${formatTime(parsed.endTime)}` : ''}
              </span>
            </div>
            <div className="seg seg--full">
              <button
                type="button"
                className={`seg-btn${kind === 'task' ? ' seg-btn--on' : ''}`}
                onClick={() => setKindOverride('task')}
              >
                ✅ Task
              </button>
              <button
                type="button"
                className={`seg-btn${kind === 'event' ? ' seg-btn--on' : ''}`}
                onClick={() => setKindOverride('event')}
              >
                📅 Event
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
