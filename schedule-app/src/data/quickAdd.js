// The floating "+" button's expandable quick-add menu (Pro: reorder + hide
// individual actions).
// `pro` marks an action that's gated. The pill still shows for everyone —
// tapping it routes to pricing, same as every other Pro entry point — but it
// carries a lock so the gate is visible before the tap rather than after.
export const QUICK_ADD_TYPES = [
  { id: 'event', label: 'Event', icon: 'calendar' },
  { id: 'task', label: 'Task', icon: 'check' },
  { id: 'contact', label: 'Contact', icon: 'person' },
  { id: 'note', label: 'Note', icon: 'note' },
  { id: 'smart', label: 'Smart add', icon: 'sparkle', pro: true },
];

export const DEFAULT_QUICK_ADD = QUICK_ADD_TYPES.map((t) => ({ id: t.id, enabled: true }));

// Same merge pattern as normalizeHomeBlocks (see ../data/homeBlocks.js).
export function normalizeQuickAdd(list) {
  const known = new Set(QUICK_ADD_TYPES.map((t) => t.id));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, enabled: !!item.enabled });
  }
  for (const t of QUICK_ADD_TYPES) {
    if (!seen.has(t.id)) out.push({ id: t.id, enabled: true });
  }
  return out;
}
