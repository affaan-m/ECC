// Primary nav tabs (Pro feature: reorder + show/hide). Icons live in
// TabBar.jsx since they're SVGs, not data — this just holds ids/labels/routes.
export const TAB_TYPES = [
  { id: 'home', label: 'Home', to: '/' },
  { id: 'goals', label: 'Goals', to: '/goals' },
  { id: 'planner', label: 'Planner', to: '/planner' },
  { id: 'contacts', label: 'People', to: '/contacts' },
  { id: 'map', label: 'Map', to: '/map' },
  { id: 'more', label: 'More', to: '/more' },
];

export const DEFAULT_TAB_ORDER = TAB_TYPES.map((t) => ({ id: t.id, enabled: true }));

// Merges a stored config with the full set of known tabs (so newly added
// tabs show up for existing users, and unknown/duplicate/stale entries never
// break rendering), and enforces two safety rules: "More" can be reordered
// but never hidden (it's the only way back to this settings screen), and if
// every other tab got disabled, Home comes back on so there's still
// somewhere to land.
export function normalizeTabOrder(list) {
  const known = new Set(TAB_TYPES.map((t) => t.id));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, enabled: item.id === 'more' ? true : !!item.enabled });
  }
  for (const t of TAB_TYPES) {
    if (!seen.has(t.id)) out.push({ id: t.id, enabled: true });
  }
  if (!out.some((t) => t.id !== 'more' && t.enabled)) {
    const home = out.find((t) => t.id === 'home');
    if (home) home.enabled = true;
  }
  return out;
}
