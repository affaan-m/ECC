import { useEffect, useRef, useState } from 'react';
import { useBackDismiss } from '../data/useBackDismiss.js';

// A bottom-sheet modal used for all add/edit forms. Supports swipe-down to
// dismiss (drag the handle or header) and an optional taller default height.
export default function Modal({ open, title, onClose, children, footer, tall = false }) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef(null);
  const dragging = useRef(false);

  useBackDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;
    setDragY(0);
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const onPointerDown = (e) => {
    startY.current = e.clientY;
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId); // keep events after leaving the grip
  };
  const onPointerMove = (e) => {
    if (!dragging.current || startY.current == null) return;
    const dy = e.clientY - startY.current;
    if (dy > 0) setDragY(dy); // only allow dragging down
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragY > 120) onClose();
    else setDragY(0);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal-sheet${tall ? ' modal-sheet--tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging.current ? 'none' : undefined,
        }}
      >
        <div
          className="modal-grip"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="modal-handle" />
        </div>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
