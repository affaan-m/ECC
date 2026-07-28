import { forwardRef } from 'react';
import SwipeRow from './SwipeRow.jsx';

// Swipe-left-to-delete, the original and still the only thing the task list
// wants. Now a preset over SwipeRow (which grew a second direction for the
// People list) rather than a second copy of the gesture code.
const SwipeToDelete = forwardRef(function SwipeToDelete({ onDelete, children, disabled }, ref) {
  return (
    <SwipeRow
      ref={ref}
      disabled={disabled}
      swipeLeft={{
        icon: <DeleteIcon />,
        tone: 'var(--danger)',
        destructive: true,
        run: onDelete,
      }}
    >
      {children}
    </SwipeRow>
  );
});

export default SwipeToDelete;

export function DeleteIcon() {
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
