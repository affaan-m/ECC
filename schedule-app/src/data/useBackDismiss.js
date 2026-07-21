import { useEffect, useRef } from 'react';

// Makes the browser/OS back gesture close an open overlay (event detail,
// a simple modal, a full editor sheet) instead of navigating the whole app
// away from the page behind it.
//
// All overlays share ONE history entry, reference-counted, rather than each
// pushing its own: swapping one overlay for another in the same render (e.g.
// "Delete" replaces an edit sheet with a confirm dialog) would otherwise race
// — React tears down the old effect and stands up the new one in the same
// flush, but history.back() only resolves on a later tick, so it can end up
// popping whatever the *new* overlay just pushed instead of the stale entry.
// Popping the shared entry is deferred to a microtask so a same-tick swap
// nets out to zero history operations instead of a pop-then-push race.
let openCount = 0;
let pushedForApp = false;
let pushedHash = null; // location.hash at push time, to detect a real navigation
const stack = []; // { onBack } for currently-open overlays, most recent last
let listenerAttached = false;

function pushEntry() {
  window.history.pushState({ __overlay: true }, '');
  pushedForApp = true;
  pushedHash = window.location.hash;
}

function maybePop() {
  Promise.resolve().then(() => {
    if (openCount !== 0 || !pushedForApp) return;
    // If the app itself navigated to a new route while the overlay was
    // still technically "open" (e.g. a delete confirm's own button calls
    // navigate() without first flipping the overlay's `open` state), the
    // hash has already moved on — popping now would undo that navigation
    // instead of just cleaning up our stale entry, so leave it be.
    if (window.location.hash !== pushedHash) {
      pushedForApp = false;
      return;
    }
    pushedForApp = false;
    window.history.back();
  });
}

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener('popstate', () => {
    pushedForApp = false;
    const top = stack[stack.length - 1];
    if (!top) return;
    const stillOpen = top.onBack();
    // The top overlay chose to stay open in a different sub-state (e.g. show
    // an unsaved-changes confirm) rather than actually close — re-arm
    // immediately so the next physical back press is still caught.
    if (stillOpen) pushEntry();
  });
}

function register(onBack) {
  ensureListener();
  const entry = { onBack };
  stack.push(entry);
  openCount++;
  if (openCount === 1) pushEntry();
  return () => {
    openCount--;
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
    maybePop();
  };
}

// Simple case: back always fully closes the overlay.
export function useBackDismiss(open, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return register(() => {
      onCloseRef.current();
      return false;
    });
  }, [open]);
}

// Advanced case: the caller decides per back-press whether the overlay is
// still open (e.g. EditorSheet's unsaved-changes confirm is its own "layer"
// within the same open lifetime). `onBack` returns true to keep intercepting
// the next back press, false/undefined to let it fully close.
export function useBackDismissAdvanced(open, onBack) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!open) return;
    return register(() => onBackRef.current());
  }, [open]);
}
