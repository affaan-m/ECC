// Home screen bubble types (Pro feature: customizable set + order).
export const BUBBLE_TYPES = [
  { id: 'goals', label: 'Goals', icon: '🎯' },
  { id: 'tasks', label: 'Tasks', icon: '✅' },
  { id: 'notes', label: 'Notes', icon: '📝' },
  { id: 'events', label: 'Upcoming event', icon: '📅' },
  { id: 'contacts', label: 'People', icon: '👤' },
];

export const DEFAULT_HOME_BUBBLES = BUBBLE_TYPES.map((b) => ({ id: b.id, enabled: b.id === 'goals' }));

// Merges a stored config with the full set of known bubble types so newly
// added types show up (disabled) for existing users, and unknown/duplicate
// entries from stale data never break rendering.
export function normalizeHomeBubbles(list) {
  const known = new Set(BUBBLE_TYPES.map((b) => b.id));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, enabled: !!item.enabled });
  }
  for (const b of BUBBLE_TYPES) {
    if (!seen.has(b.id)) out.push({ id: b.id, enabled: b.id === 'goals' });
  }
  return out;
}
