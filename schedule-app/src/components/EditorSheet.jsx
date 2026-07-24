import { useEffect, useRef, useState } from 'react';
import { confirmTick, warnTick } from '../data/haptics.js';
import { useBackDismissAdvanced } from '../data/useBackDismiss.js';

const DISMISS_THRESHOLD = 110;

// Full-page editor used for events, goals, and people. Replaces the old 3/4
// bottom sheet: covers the whole screen, saves via a checkmark top-right, and
// swiping down prompts Save / Discard / Cancel when there are unsaved changes.
//
// `dirty` tells the sheet whether the draft differs from what it started
// with — pass a cheap comparison (e.g. JSON.stringify(draft) !== initialJson)
// from the caller, since only it knows its form shape.
export default function EditorSheet({
  open,
  title,
  dirty,
  onSave,
  onDiscard,
  saveDisabled,
  danger, // { label, onClick } for a delete-style action, shown bottom-left of the header
  children,
}) {
  const [dragY, setDragY] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const startY = useRef(null);
  const dragging = useRef(false);
  const confirmCloseRef = useRef(confirmClose);
  confirmCloseRef.current = confirmClose;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  useEffect(() => {
    if (!open) return;
    setDragY(0);
    setConfirmClose(false);
    setJustSaved(false);
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Let the browser/OS back gesture close this sheet (respecting unsaved
  // changes) instead of navigating the whole app away from the page behind
  // it: each back press consumes one "layer" (the confirm dialog, then the
  // sheet itself) rather than fully discarding on the first press.
  useBackDismissAdvanced(open, () => {
    if (confirmCloseRef.current) {
      setConfirmClose(false);
      return true;
    }
    if (dirtyRef.current) {
      warnTick();
      setConfirmClose(true);
      return true;
    }
    onDiscardRef.current();
    return false;
  });

  if (!open) return null;

  const requestClose = () => {
    if (dirty) {
      warnTick();
      setConfirmClose(true);
    } else {
      onDiscard();
    }
  };

  const doSave = () => {
    onSave();
    confirmTick();
    setJustSaved(true);
  };

  const onPointerDown = (e) => {
    // Ignore drags starting inside a scrollable form field or button.
    if (e.target.closest('button, input, textarea, select, .select-trigger')) return;
    startY.current = e.clientY;
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging.current || startY.current == null) return;
    const dy = e.clientY - startY.current;
    if (dy > 0) setDragY(dy);
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragY > DISMISS_THRESHOLD) requestClose();
    setDragY(0);
  };

  return (
    <div className="editor-sheet" style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}>
      <div className="editor-sheet-drag" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="editor-sheet-grip">
          <span className="modal-handle" />
        </div>
        <div className="editor-sheet-head">
          <button className="editor-sheet-close" data-haptic="none" onClick={requestClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <h2>{title}</h2>
          <button
            className={`editor-sheet-save${justSaved ? ' editor-sheet-save--pop' : ''}`}
            data-haptic="none"
            onClick={doSave}
            disabled={saveDisabled}
            onAnimationEnd={() => setJustSaved(false)}
            aria-label="Save"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M4 12.5l5 5L20 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="editor-sheet-body">{children}</div>

      {danger && (
        <div className="editor-sheet-foot">
          <button className="btn btn-danger-ghost" onClick={danger.onClick}>
            {danger.label}
          </button>
        </div>
      )}

      {confirmClose && (
        <div className="confirm-backdrop" onClick={() => setConfirmClose(false)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <p>You have unsaved changes.</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmClose(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger-ghost"
                onClick={() => {
                  setConfirmClose(false);
                  onDiscard();
                }}
              >
                Discard
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setConfirmClose(false);
                  doSave();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
