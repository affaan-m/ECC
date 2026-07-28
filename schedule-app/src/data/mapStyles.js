// Basemap choices.
//
// All of these are free, keyless raster tile services, which is the whole
// constraint: Keystone has no server and no API budget, so anything needing
// a token (Mapbox, Google, Thunderforest) is out. Carto's Positron/Dark
// Matter and Esri's World Imagery are the standard no-key options, and each
// requires its attribution to be shown — hence the `attribution` field being
// mandatory rather than decorative.
//
// 'auto' isn't in this list because it isn't a tile source: it resolves to
// positron or dark depending on the app theme (see resolveMapStyle). A bright
// white map inside a dark-themed app is the single most jarring thing about
// the map page, and matching it automatically is what most people want
// without having to think about it.
export const MAP_STYLES = {
  standard: {
    label: 'Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  },
  positron: {
    label: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  dark: {
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
  },
};

export const MAP_STYLE_OPTIONS = [
  { value: 'auto', label: 'Match app theme' },
  ...Object.entries(MAP_STYLES).map(([value, s]) => ({ value, label: s.label })),
];

// `dark` is whether the app is currently rendering its dark palette — the
// caller knows this (it's already resolving system vs explicit theme), so
// this stays a pure function rather than reading the DOM itself.
export function resolveMapStyle(setting, dark) {
  if (!setting || setting === 'auto') return MAP_STYLES[dark ? 'dark' : 'positron'];
  return MAP_STYLES[setting] || MAP_STYLES.standard;
}
