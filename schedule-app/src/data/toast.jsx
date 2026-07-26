import { createContext, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

const DURATION_MS = 5000;
const CLOSE_ANIM_MS = 220;

// A single bottom toast (above the tab bar) with an optional action button —
// used for "Task deleted · Undo" style confirmations so a delete is always
// reversible for a few seconds instead of being instant and silent.
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { id, message, actionLabel, onAction }
  const [closing, setClosing] = useState(false);
  const timerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const dismissNow = () => {
    clearTimeout(timerRef.current);
    clearTimeout(closeTimerRef.current);
    setToast(null);
    setClosing(false);
  };

  const beginClose = () => {
    setClosing(true);
    closeTimerRef.current = setTimeout(() => setToast(null), CLOSE_ANIM_MS);
  };

  const showToast = (message, actionLabel, onAction) => {
    clearTimeout(timerRef.current);
    clearTimeout(closeTimerRef.current);
    setClosing(false);
    setToast({ id: Date.now(), message, actionLabel, onAction });
    timerRef.current = setTimeout(beginClose, DURATION_MS);
  };

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div className={`toast${closing ? ' toast--closing' : ''}`} role="status">
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
