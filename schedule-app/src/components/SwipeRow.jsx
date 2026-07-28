import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { warnTick, confirmTick } from '../data/haptics.js';

const ARM_THRESHOLD_PX = 90;
const MAX_SWIPE_PX = 120;
const MOVE_ARM_PX = 8;

// Wraps a list row with a swipe gesture in either direction.
//
// Each direction takes an action descriptor — { label, icon, tone, run,
// destructive } — or nothing at all, in which case that direction simply
// doesn't move. Dragging reveals the action's coloured strip behind the row;
// crossing the threshold arms it (with a tick); releasing while armed runs
// it. A destructive action slides the row away first, everything else snaps
// back so the row stays put after, say, logging contact with someone.
//
// This is a generalisation of the old delete-only version: the gesture
// mechanics (horizontal-vs-vertical arbitration, click suppression, the
// imperative remove()) are unchanged and were already the fiddly part, so
// they're kept exactly as they were rather than rewritten.
const SwipeRow = forwardRef(function SwipeRow(
  { swipeRight, swipeLeft, children, disabled },
  ref
) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const gestureRef = useRef(null); // { startX, startY, pointerId, dragging, armed }
  const suppressClickRef = useRef(false);

  // Which action a given offset is reaching for. Dragging the row to the
  // right uncovers the left edge, so that's where `swipeRight` shows.
  const actionFor = (offset) => (offset > 0 ? swipeRight : offset < 0 ? swipeLeft : null);
  const active = actionFor(dx);

  const slideAway = (dir, run) => {
    setDragging(false);
    setRemoving(true);
    setDx(dir * 480);
    setTimeout(() => run(), 200);
  };

  useImperativeHandle(ref, () => ({
    // Kept for rows with their own delete button, so it plays the same
    // slide-away as a real swipe rather than the row blinking out.
    remove: () => {
      if (removing) return;
      const destructive = [swipeLeft, swipeRight].find((a) => a?.destructive);
      if (!destructive) return;
      slideAway(destructive === swipeRight ? 1 : -1, destructive.run);
    },
  }));

  const onPointerDown = (e) => {
    if (disabled || removing) return;
    gestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      dragging: false,
      armed: false,
    };
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
    // A direction with no action configured doesn't budge, so there's no
    // dead strip revealed behind the row for a gesture that can't do
    // anything.
    const allowed = actionFor(dxRaw);
    const clamped = allowed ? Math.max(-MAX_SWIPE_PX, Math.min(MAX_SWIPE_PX, dxRaw)) : 0;
    setDx(clamped);
    const nowArmed = Math.abs(clamped) >= ARM_THRESHOLD_PX;
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
    const action = actionFor(dx);
    if (g.armed && action) {
      if (action.destructive) {
        slideAway(dx > 0 ? 1 : -1, action.run);
      } else {
        // Snap back first — the row is staying, and running the action on
        // the way back reads as the row acknowledging it rather than
        // something happening after a pause.
        setDx(0);
        confirmTick();
        action.run();
      }
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
      {active && (
        <div
          className={`swipe-row-bg swipe-row-bg--${dx > 0 ? 'start' : 'end'}`}
          style={{ background: active.tone }}
          aria-hidden="true"
        >
          <span className="swipe-row-icon">{active.icon}</span>
          {active.label && <span className="swipe-row-label">{active.label}</span>}
        </div>
      )}
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

export default SwipeRow;
