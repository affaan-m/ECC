import { useRef, useState } from 'react';
import { confirmTick, selectTick } from '../data/haptics.js';

// Shared drag-to-reorder + enable toggle list, used anywhere the app lets a
// user reorder/hide a fixed set of named items — Settings' bubble/tab lists,
// and the Home page's own inline block editor. `items` is [{id, enabled}]
// in display order; `types` supplies each id's label (and optional icon);
// `lockedIds` marks ids whose toggle is forced on and non-interactive (e.g.
// the nav tab that's the only way back to Settings).
export default function ReorderToggleList({ items, types, onChange, lockedIds = [] }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef(null);
  const rowRefs = useRef([]);

  const reorder = (from, to) => {
    if (from === to) return;
    const next = items.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const onDown = (i) => (e) => {
    const rowH = rowRefs.current[i]?.getBoundingClientRect().height || 48;
    dragRef.current = { index: i, startY: e.clientY, rowH };
    setDragIndex(i);
    setDragY(0);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    confirmTick();
  };
  const onMove = (e) => {
    const g = dragRef.current;
    if (!g) return;
    const dy = e.clientY - g.startY;
    setDragY(dy);
    const steps = Math.round(dy / g.rowH);
    if (steps !== 0) {
      const target = Math.max(0, Math.min(items.length - 1, g.index + steps));
      if (target !== g.index) {
        reorder(g.index, target);
        g.startY += (target - g.index) * g.rowH;
        g.index = target;
        setDragIndex(target);
        setDragY(e.clientY - g.startY);
        selectTick();
      }
    }
  };
  const onUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragIndex(null);
    setDragY(0);
    confirmTick();
  };

  return (
    <ul className="bubble-reorder-list">
      {items.map((it, i) => {
        const type = types.find((t) => t.id === it.id);
        const locked = lockedIds.includes(it.id);
        const dragging = dragIndex === i;
        return (
          <li
            key={it.id}
            ref={(el) => (rowRefs.current[i] = el)}
            className={`bubble-reorder-row${dragging ? ' bubble-reorder-row--dragging' : ''}`}
            style={dragging ? { transform: `translateY(${dragY}px)` } : undefined}
          >
            <button
              type="button"
              className="bubble-drag-handle"
              onPointerDown={onDown(i)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
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
