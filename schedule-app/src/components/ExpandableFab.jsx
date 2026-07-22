import { useState } from 'react';
import { useStore } from '../data/store.jsx';
import { QUICK_ADD_TYPES, normalizeQuickAdd } from '../data/quickAdd.js';
import { selectTick } from '../data/haptics.js';

// Floating "+" that expands into a stack of labeled pills (one per enabled
// quick-add action, in the user's configured order) instead of jumping
// straight to a single action. The trigger rotates into an "x" while open.
// `onAction(id)` is called with the tapped action's id ('event' | 'task' |
// 'contact' | 'note'); the menu closes itself first.
export default function ExpandableFab({ onAction }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const items = normalizeQuickAdd(state.settings?.quickAdd).filter((i) => i.enabled);

  if (items.length === 0) {
    return null;
  }

  const toggle = () => {
    setOpen((o) => !o);
    selectTick();
  };

  return (
    <>
      {open && <div className="expandable-fab-backdrop" onClick={() => setOpen(false)} />}
      <div className="expandable-fab">
        <button
          className={`fab expandable-fab-trigger${open ? ' expandable-fab-trigger--open' : ''}`}
          onClick={toggle}
          aria-label={open ? 'Close quick add' : 'Quick add'}
          aria-expanded={open}
        >
          +
        </button>
        {open &&
          items.map((it, i) => {
            const type = QUICK_ADD_TYPES.find((t) => t.id === it.id);
            return (
              <button
                key={it.id}
                type="button"
                className="expandable-fab-pill"
                style={{ animationDelay: `${i * 30}ms` }}
                onClick={() => {
                  setOpen(false);
                  onAction(it.id);
                }}
              >
                <span className="expandable-fab-pill-icon">{type?.icon}</span>
                {type?.label}
              </button>
            );
          })}
      </div>
    </>
  );
}
