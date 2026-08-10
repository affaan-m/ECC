import { createContext, useContext, useRef, useState } from 'react';
import { confirmTick } from './haptics.js';

const ToastContext = createContext(null);

const DURATION_MS = 5000;
const CLOSE_ANIM_MS = 220;
// How far, in any direction, a drag has to travel before letting go counts
// as "throw it away" rather than "snap back" — same distance SwipeRow and
// the Planner's day-swipe already use for a released gesture to commit.
const DISMISS_DRAG_PX = 60;
const FLY_OUT_MS = 200;

// A single bottom toast (above the tab bar) with an optional action button —
// used for "Task deleted · Undo" style confirmations so a delete is always
// reversible for a few seconds instead of being instant and silent.
//
// Also draggable away in any direction, not just left-to-right or
// down-to-dismiss: it's a small floating card sitting over content someone
// might want back immediately, and there was previously no faster way to
// clear it than waiting out the 5s timer or hitting Undo (which fires the
// action, not just closing the toast). A flick in any direction now closes
// it without touching Undo.
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { id, message, actionLabel, onAction }
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(null); // { dx, dy, dragging, flying } | null
  const timerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const flyTimerRef = useRef(null);
  const dragStartRef = useRef(null); // { x, y, pointerId }

  const dismissNow = () => {
    clearTimeout(timerRef.current);
    clearTimeout(closeTimerRef.current);
    clearTimeout(flyTimerRef.current);
    setToast(null);
    setClosing(false);
    setDrag(null);
  };

  const beginClose = () => {
    setClosing(true);
    closeTimerRef.current = setTimeout(() => setToast(null), CLOSE_ANIM_MS);
  };

  const showToast = (message, actionLabel, onAction) => {
    clearTimeout(timerRef.current);
    clearTimeout(closeTimerRef.current);
    clearTimeout(flyTimerRef.current);
    setClosing(false);
    setDrag(null);
    setToast({ id: Date.now(), message, actionLabel, onAction });
    timerRef.current = setTimeout(beginClose, DURATION_MS);
  };

  const onPointerDown = (e) => {
    if (e.target.closest('.toast-action')) return; // let the Undo tap through untouched
    dragStartRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    clearTimeout(timerRef.current); // don't auto-dismiss out from under a held drag
    setDrag({ dx: 0, dy: 0, dragging: true, flying: false });
  };
  const onPointerMove = (e) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    setDrag({ dx: e.clientX - start.x, dy: e.clientY - start.y, dragging: true, flying: false });
  };
  const onPointerUp = (e) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    dragStartRef.current = null;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > DISMISS_DRAG_PX) {
      confirmTick();
      // Keep travelling the same direction, out past the edge, then remove.
      setDrag({ dx: dx * 3, dy: dy * 3, dragging: false, flying: true });
      flyTimerRef.current = setTimeout(dismissNow, FLY_OUT_MS);
    } else {
      // Under the threshold: let go of the drag styling so the toast's own
      // CSS transform/transition eases it back to center, and pick the
      // auto-dismiss clock back up from now rather than wherever it was
      // when the drag started.
      setDrag(null);
      timerRef.current = setTimeout(beginClose, DURATION_MS);
    }
  };

  const dragStyle = drag
    ? {
        transform: `translate(calc(-50% + ${drag.dx}px), ${drag.dy}px)`,
        transition: drag.dragging ? 'none' : `transform ${FLY_OUT_MS}ms ease, opacity ${FLY_OUT_MS}ms ease`,
        opacity: drag.flying ? 0 : 1,
      }
    : undefined;

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div
          className={`toast${closing ? ' toast--closing' : ''}`}
          role="status"
          style={dragStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="toast-message">{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              className="toast-action"
              data-haptic="none"
              onClick={() => {
                toast.onAction?.();
                dismissNow();
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// Returns showToast(message, actionLabel?, onAction?) — call with just a
// message for a plain confirmation, or with actionLabel/onAction for an
// "Undo" button.
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
