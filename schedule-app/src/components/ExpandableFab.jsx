import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../data/store.jsx';
import { QUICK_ADD_TYPES, normalizeQuickAdd } from '../data/quickAdd.js';

// Floating "+" that expands into a stack of labeled pills (one per enabled
// quick-add action, in the user's configured order) instead of jumping
// straight to a single action. The trigger rotates into an "x" while open.
// `onAction(id)` is called with the tapped action's id ('event' | 'task' |
// 'contact' | 'note'); the menu closes itself first. Haptics on the trigger
// come from the app-wide delegated listener (it's a .fab, same as every
// other FAB) rather than a call here, so it doesn't double up.
export default function ExpandableFab({ onAction }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const items = normalizeQuickAdd(state.settings?.quickAdd).filter((i) => i.enabled);
  const isPro = !!state.settings?.isPro;

  if (items.length === 0) {
    return null;
  }

  const toggle = () => setOpen((o) => !o);

  // Rendered into <body> rather than inline. The pages that host this FAB
  // sit inside .page, which runs the page-in animation — and a transformed
  // ancestor becomes the containing block for its position:fixed
  // descendants. So for the 0.42s of that animation the FAB was being
  // positioned against the page's content box instead of the viewport,
  // appearing partway up the screen and snapping to the bottom when the
  // transform cleared. A portal takes it out of reach of any ancestor
  // transform, on every page, permanently.
  return createPortal(
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
            const locked = !!type?.pro && !isPro;
            return (
              <button
                key={it.id}
                type="button"
                className="expandable-fab-pill"
                style={{ animationDelay: `${i * 30}ms` }}
                aria-label={locked ? `${type?.label} — Pro` : undefined}
                onClick={() => {
                  setOpen(false);
                  onAction(it.id);
                }}
              >
                <span className="expandable-fab-pill-icon">{type?.icon}</span>
                {type?.label}
                {locked && <span className="expandable-fab-pill-lock">🔒</span>}
              </button>
            );
          })}
      </div>
    </>,
    document.body
  );
}
