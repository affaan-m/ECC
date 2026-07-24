import { useEffect, useRef, useState } from 'react';

// Shared themed checkbox: a real <input type="checkbox"> (hidden but still
// focusable/keyboard-operable) under a custom round visual that matches the
// app's existing task-done styling (see .task-check in styles.css) so every
// checkbox in the app looks the same, rather than the browser's native
// control. Bounces and throws a few green sparks the moment it's checked —
// gated behind a short-lived "just checked" flag (not simply :checked) so
// items that are already done on mount don't replay the celebration.
export default function Checkbox({ checked, onChange, id, ariaLabel }) {
  const [justChecked, setJustChecked] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleChange = (e) => {
    onChange(e);
    clearTimeout(timerRef.current);
    if (e.target.checked) {
      setJustChecked(true);
      timerRef.current = setTimeout(() => setJustChecked(false), 500);
    } else {
      setJustChecked(false);
    }
  };

  return (
    <span
      className={`theme-checkbox task-check${checked ? ' task-check--on' : ''}${justChecked ? ' task-check--pop' : ''}`}
    >
      <input
        type="checkbox"
        className="theme-checkbox-input"
        checked={!!checked}
        onChange={handleChange}
        id={id}
        aria-label={ariaLabel}
        data-haptic={checked ? 'tap' : 'success'}
      />
      {checked && (
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M4 12l5 5 11-11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span className="task-check-sparkles" aria-hidden="true">
        <i /><i /><i /><i /><i /><i />
      </span>
    </span>
  );
}
