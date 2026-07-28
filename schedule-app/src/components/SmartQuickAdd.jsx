import { useState } from 'react';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';
import { useStore } from '../data/store.jsx';
import { parseQuickAdd } from '../data/smartParse.js';
import { formatShortDate, formatTime } from '../data/helpers.js';

const REPEAT_LABEL = {
  daily: 'every day',
  weekly: 'every week',
  biweekly: 'every 2 weeks',
  monthly: 'every month',
};

const DAY_LETTER = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function repeatText(parsed) {
  if (parsed.repeat === 'custom') {
    return `every ${parsed.repeatDays.map((d) => DAY_LETTER[d]).join('/')}`;
  }
  return REPEAT_LABEL[parsed.repeat] || '';
}

function durationText(mins) {
  if (!mins) return '';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

// Pro quick-add: type free text like "coffee with Alex fri 3pm for 45 min,
// remind me 10 minutes before" and it's parsed offline (see
// data/smartParse.js) into a title plus whatever else it can recognize —
// date, time, length, the person, a place, a repeat, a reminder — all shown
// as chips so you can see what it understood before committing. The
// Task/Event toggle defaults to whichever the parse implies but is always
// overridable.
export default function SmartQuickAdd({ open, onClose, onCreate }) {
  const { state } = useStore();
  const [text, setText] = useState('');
  const [kindOverride, setKindOverride] = useState(null);

  const parsed = text.trim() ? parseQuickAdd(text, { contacts: state.contacts }) : null;
  const kind = kindOverride || parsed?.kind || 'task';

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

  const chips = parsed
    ? [
        parsed.date && { icon: 'calendar', text: formatShortDate(parsed.date) },
        parsed.time && {
          icon: 'clock',
          text: `${formatTime(parsed.time)}${parsed.endTime ? `–${formatTime(parsed.endTime)}` : ''}`,
        },
        parsed.durationMinutes && !parsed.endTime && {
          icon: 'clock',
          text: durationText(parsed.durationMinutes),
        },
        parsed.repeat !== 'none' && { icon: 'repeat', text: repeatText(parsed) },
        parsed.contactName && { icon: 'person', text: parsed.contactName },
        parsed.location && { icon: 'pin', text: parsed.location },
        parsed.reminderMinutes && {
          icon: 'bell',
          text: `${durationText(parsed.reminderMinutes)} before`,
        },
      ].filter(Boolean)
    : [];

  return (
    <Modal
      open={open}
      title={
        <>
          <Icon name="sparkle" /> Smart add
        </>
      }
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
            placeholder='e.g. "coffee with Sam fri 3pm for 45 min"'
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        {parsed && (
          <>
            <div className="smart-preview">
              <strong>{parsed.title || '…'}</strong>
              {chips.length > 0 ? (
                <div className="smart-chips">
                  {chips.map((c, i) => (
                    <span key={i} className="smart-chip">
                      <Icon name={c.icon} size={13} /> {c.text}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="muted small">No date or time found</span>
              )}
            </div>
            <div className="seg seg--full">
              <button
                type="button"
                className={`seg-btn${kind === 'task' ? ' seg-btn--on' : ''}`}
                onClick={() => setKindOverride('task')}
              >
                <Icon name="check" /> Task
              </button>
              <button
                type="button"
                className={`seg-btn${kind === 'event' ? ' seg-btn--on' : ''}`}
                onClick={() => setKindOverride('event')}
              >
                <Icon name="calendar" /> Event
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
