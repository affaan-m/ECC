// Best-effort haptic feedback via the Vibration API. Supported on Android
// Chrome/Firefox; iOS Safari does not expose navigator.vibrate at all (Apple
// only allows haptics through native app frameworks), so this silently
// no-ops there — it's a progressive enhancement, never required.
const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let enabled = true;
export function setHapticsEnabled(v) {
  enabled = !!v;
}

function fire(pattern) {
  if (!supported || !enabled) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore — haptics are a nice-to-have */
  }
}

// Light tick for routine taps: buttons, tabs, chips, dropdown choices.
export function tapTick() {
  fire(8);
}

// Slightly firmer pulse for a committed action: save, add, toggle on.
export function confirmTick() {
  fire(14);
}

// Two-pulse pattern for a destructive action: delete, discard.
export function warnTick() {
  fire([12, 40, 12]);
}

// Very light tick for continuous feedback: stepper +/-, drag snapping to a
// new slot, typing (used sparingly — see input helpers).
export function selectTick() {
  fire(5);
}

// A brighter double-pulse for the moment something gets genuinely completed
// (a task checked off, a goal target reached) — distinct from confirmTick's
// single pulse so a real accomplishment reads differently from a routine
// save/toggle, pairing with the checkmark bounce + spark animation.
export function successTick() {
  fire([10, 30, 18]);
}
