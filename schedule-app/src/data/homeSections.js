// The full-width sections on Home, below the bubble row (Pro feature:
// reorder + show/hide). All three already exist on the page unconditionally
// today — this just makes their order and visibility configurable.
export const HOME_SECTION_TYPES = [
  { id: 'reminders', label: 'Important reminders', icon: '🔔' },
  { id: 'tasks', label: 'Tasks', icon: '✅' },
  { id: 'notes', label: 'Notes', icon: '📝' },
];

export const DEFAULT_HOME_SECTIONS = HOME_SECTION_TYPES.map((s) => ({ id: s.id, enabled: true }));

// Same merge pattern as normalizeHomeBubbles: keeps stored order/enabled
// flags for known sections, drops stale/unknown/duplicate entries, and
// appends any new section type (enabled) so it shows up for existing users.
export function normalizeHomeSections(list) {
  const known = new Set(HOME_SECTION_TYPES.map((s) => s.id));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, enabled: !!item.enabled });
  }
  for (const s of HOME_SECTION_TYPES) {
    if (!seen.has(s.id)) out.push({ id: s.id, enabled: true });
  }
  return out;
}
