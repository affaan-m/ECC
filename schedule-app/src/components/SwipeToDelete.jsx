import { forwardRef } from 'react';
import SwipeRow from './SwipeRow.jsx';
import Icon from './Icon.jsx';

// Swipe-left-to-delete, the original and still the only thing the task list
// wants. Now a preset over SwipeRow (which grew a second direction for the
// People list) rather than a second copy of the gesture code.
const SwipeToDelete = forwardRef(function SwipeToDelete({ onDelete, children, disabled }, ref) {
  return (
    <SwipeRow
      ref={ref}
      disabled={disabled}
      swipeLeft={{
        icon: 'trash',
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

// Kept as a named export for the handful of places that render a delete
// glyph outside a swipe row.
export function DeleteIcon() {
  return <Icon name="trash" size={20} />;
}
