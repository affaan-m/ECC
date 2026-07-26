// The floating "+" button's expandable quick-add menu (Pro: reorder + hide
// individual actions).
export const QUICK_ADD_TYPES = [
  { id: 'event', label: 'Event', icon: '📅' },
  { id: 'task', label: 'Task', icon: '✅' },
  { id: 'contact', label: 'Contact', icon: '👤' },
  { id: 'note', label: 'Note', icon: '📝' },
  { id: 'smart', label: 'Smart add', icon: '✨' },
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
