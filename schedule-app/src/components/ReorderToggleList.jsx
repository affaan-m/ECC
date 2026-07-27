import { useEffect, useRef, useState } from 'react';
import { confirmTick, selectTick } from '../data/haptics.js';

// Shared drag-to-reorder + enable toggle list, used anywhere the app lets a
// user reorder/hide a fixed set of named items — Settings' bubble/tab lists,
// and the Home page's own inline block editor. `items` is [{id, enabled}]
// in display order; `types` supplies each id's label (and optional icon);
// `lockedIds` marks ids whose toggle is forced on and non-interactive (e.g.
// the nav tab that's the only way back to Settings).
//
// The drag deliberately does *not* reorder `items` as your finger moves. It
// used to, and every crossing re-rendered the list in its new order with no
// transition — so the rows teleported around under your finger and the whole
// thing felt like it was fighting you. Instead the order is left alone for
// the duration and each row is offset by a transform: the dragged row tracks
// the finger exactly, the rows it displaces glide one slot out of the way,
// and the real reorder is committed once on release. That also makes the
// landing unambiguous, since the gap you're about to drop into is visibly
// open the whole time.
export default function ReorderToggleList({ items, types, onChange, lockedIds = [] }) {
  // { from, to, dy } while dragging, else null.
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const rowRefs = useRef([]);
  const listRef = useRef(null);

  // Distance between one row's top and the next, so the offset matches the
  // list's real rhythm including the flex gap. Two adjacent rows give it
  // exactly; a single-row list never drags anywhere so the fallback is moot.
  const stepSize = () => {
    const a = rowRefs.current[0]?.getBoundingClientRect();
    const b = rowRefs.current[1]?.getBoundingClientRect();
    if (a && b) return Math.abs(b.top - a.top);
    return (a?.height || 48) + 8;
  };

  const endDrag = (commit) => {
    const g = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!g) return;
    if (commit && g.to !== g.from) {
      const next = items.slice();
      const [moved] = next.splice(g.from, 1);
      next.splice(g.to, 0, moved);
      onChange(next);
      confirmTick();
    }
  };

  // A pointer lost outside the handle (cancelled gesture, page hidden) must
  // not leave the list stuck mid-drag.
  useEffect(() => {
    if (!drag) return undefined;
    const bail = () => endDrag(false);
    window.addEventListener('blur', bail);
    return () => window.removeEventListener('blur', bail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  const onDown = (i) => (e) => {
    dragRef.current = { from: i, to: i, startY: e.clientY, step: stepSize() };
    setDrag({ from: i, to: i, dy: 0 });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    confirmTick();
  };

  const onMove = (e) => {
    const g = dragRef.current;
    if (!g) return;
    const dy = e.clientY - g.startY;
    // Round, so a slot is claimed once the row is more than halfway into it.
    const to = Math.max(0, Math.min(items.length - 1, g.from + Math.round(dy / g.step)));
    if (to !== g.to) {
      g.to = to;
      selectTick();
    }
    setDrag({ from: g.from, to, dy });
  };

  const onUp = () => endDrag(true);
  const onCancel = () => endDrag(false);

  // How far row `i` should sit from its laid-out position, in whole slots.
  const offsetFor = (i) => {
    if (!drag) return 0;
    const { from, to } = drag;
    if (i === from) return null; // follows the finger instead
    if (from < to && i > from && i <= to) return -1;
    if (from > to && i >= to && i < from) return 1;
    return 0;
  };

  const step = dragRef.current?.step || 0;

  return (
    <ul className="bubble-reorder-list" ref={listRef}>
      {items.map((it, i) => {
        const type = types.find((t) => t.id === it.id);
        const locked = lockedIds.includes(it.id);
        const dragging = drag?.from === i;
        const slots = offsetFor(i);
        return (
          <li
            key={it.id}
            ref={(el) => (rowRefs.current[i] = el)}
            className={`bubble-reorder-row${dragging ? ' bubble-reorder-row--dragging' : ''}${
              drag && !dragging ? ' bubble-reorder-row--shifting' : ''
            }`}
            style={
              dragging
                ? { transform: `translateY(${drag.dy}px)` }
                : slots
                ? { transform: `translateY(${slots * step}px)` }
                : undefined
            }
          >
            <button
              type="button"
              className="bubble-drag-handle"
              data-haptic="none"
              onPointerDown={onDown(i)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
              aria-label={`Drag to reorder ${type?.label}`}
            >
              <DragHandleIcon />
            </button>
            {type?.icon && <span className="bubble-reorder-icon">{type.icon}</span>}
            <span className="bubble-reorder-label">{type?.label}</span>
            {locked ? (
              <span className="muted small">Always shown</span>
            ) : (
              <button
                type="button"
                className={`toggle${it.enabled ? ' toggle--on' : ''}`}
                role="switch"
                aria-checked={it.enabled}
                onClick={() => onChange(items.map((x) => (x.id === it.id ? { ...x, enabled: !x.enabled } : x)))}
              >
                <span className="toggle-knob" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DragHandleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" fill="currentColor" />
      <circle cx="15" cy="6" r="1.6" fill="currentColor" />
      <circle cx="9" cy="12" r="1.6" fill="currentColor" />
      <circle cx="15" cy="12" r="1.6" fill="currentColor" />
      <circle cx="9" cy="18" r="1.6" fill="currentColor" />
      <circle cx="15" cy="18" r="1.6" fill="currentColor" />
    </svg>
  );
}
