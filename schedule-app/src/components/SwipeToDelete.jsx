import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { warnTick } from '../data/haptics.js';

const DELETE_THRESHOLD_PX = 90;
const MAX_SWIPE_PX = 120;
const MOVE_ARM_PX = 8;

// Wraps a list row (task, contact, ...) with a left-swipe-to-delete gesture:
// a red strip is revealed behind the row as you drag, crossing a threshold
// arms it (with a tick), and releasing while armed slides the row away
// before calling onDelete. A swipe that never crosses the threshold snaps
// back, and the row's own buttons (checkbox, opening the editor, the
// existing delete icon, ...) still work as normal taps — the gesture only
// claims the interaction once real *horizontal* movement is detected
// (vertical movement bails out immediately so the page keeps scrolling
// normally), swallowing the click that would otherwise also fire on
// whatever button was under the finger — the same swipe-vs-tap pattern
// used for the calendar's month grid.
//
// Also exposes a `remove()` imperative method via ref so a row's own
// delete button can trigger the same slide-away-then-onDelete animation
// as a real swipe, instead of the row just vanishing instantly.
const SwipeToDelete = forwardRef(function SwipeToDelete({ onDelete, children, disabled }, ref) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const gestureRef = useRef(null); // { startX, startY, pointerId, dragging, armed }
  const suppressClickRef = useRef(false);

  useImperativeHandle(ref, () => ({
    remove: () => {
      if (removing) return;
      setDragging(false);
      setRemoving(true);
      setDx(-480);
      setTimeout(() => onDelete(), 200);
    },
  }));

  const onPointerDown = (e) => {
    if (disabled || removing) return;
    gestureRef.current = { startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, dragging: false, armed: false };
  };
  const onPointerMove = (e) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dxRaw = e.clientX - g.startX;
    const dyRaw = e.clientY - g.startY;
    if (!g.dragging) {
      if (Math.hypot(dxRaw, dyRaw) < MOVE_ARM_PX) return;
      if (Math.abs(dyRaw) > Math.abs(dxRaw)) {
        gestureRef.current = null; // more vertical than horizontal — a scroll, not a swipe
        return;
      }
      g.dragging = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const clamped = Math.max(-MAX_SWIPE_PX, Math.min(0, dxRaw));
    setDx(clamped);
    const nowArmed = clamped <= -DELETE_THRESHOLD_PX;
    if (nowArmed !== g.armed) {
      g.armed = nowArmed;
      warnTick();
    }
  };
  const onPointerUp = (e) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    if (!g.dragging) return;
    suppressClickRef.current = true;
    setDragging(false);
    if (g.armed) {
      setRemoving(true);
      setDx(-480);
      setTimeout(() => onDelete(), 200);
    } else {
      setDx(0);
    }
  };
  const onPointerCancel = () => {
    gestureRef.current = null;
    setDragging(false);
    setDx(0);
  };
  const onClickCapture = (e) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.stopPropagation();
    }
  };

  return (
    <div className="swipe-row">
      <div className="swipe-row-bg" aria-hidden="true">
        <DeleteIcon />
      </div>
      <div
        className={`swipe-row-content${removing ? ' swipe-row-content--removing' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
});

export default SwipeToDelete;

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
