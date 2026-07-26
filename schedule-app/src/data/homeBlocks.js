// Home page blocks (Pro: reorder + show/hide, editable right on the Home
// page itself, not just from Settings). Each id renders its full existing
// content — the goal rings, the whole reminders list, the whole task list,
// the whole notes grid — never a shrunk-down counter/stat tile.
export const HOME_BLOCK_TYPES = [
  { id: 'goals', label: 'Goals', icon: '🎯' },
  { id: 'nudges', label: 'Nudges', icon: '💡' },
  { id: 'reminders', label: 'Important reminders', icon: '🔔' },
  { id: 'recap', label: 'Weekly recap', icon: '📊' },
  { id: 'tasks', label: 'Tasks', icon: '✅' },
  { id: 'notes', label: 'Notes', icon: '📝' },
];

export const DEFAULT_HOME_BLOCKS = HOME_BLOCK_TYPES.map((b) => ({ id: b.id, enabled: true }));

// Same merge pattern used across the app's other reorderable lists: keeps
// stored order/enabled flags for known blocks, drops stale/unknown/
// duplicate entries, and appends any new block type (enabled) so it shows
// up for existing users without a migration step.
export function normalizeHomeBlocks(list) {
  const known = new Set(HOME_BLOCK_TYPES.map((b) => b.id));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, enabled: !!item.enabled });
  }
  for (const b of HOME_BLOCK_TYPES) {
    if (!seen.has(b.id)) out.push({ id: b.id, enabled: true });
  }
  return out;
}
