import { distanceMeters } from './helpers.js';

// Greedy nearest-neighbor route ordering — a lightweight, fully offline
// heuristic (no routing API, no paid service, no network dependency) that
// orders a set of stops starting from `start` by always jumping to the
// closest remaining stop in a straight line. It's not true shortest-path
// (that needs real road data and is NP-hard to solve exactly anyway), but
// it's a solid, zero-cost approximation of "what order should I visit these
// in" — turn-by-turn driving directions for the resulting order still come
// from Google Maps (see buildGoogleMapsUrl below).
export function optimizeRoute(start, stops) {
  const remaining = [...stops];
  const ordered = [];
  let current = start;
  let totalMeters = 0;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceMeters(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push({ ...next, legMeters: bestDist });
    totalMeters += bestDist;
    current = next;
  }

  return { stops: ordered, totalMeters };
}

export function formatDistance(meters) {
  const miles = meters / 1609.34;
  return miles < 0.1 ? `${Math.round(meters)} m` : `${miles.toFixed(1)} mi`;
}

// A single Google Maps multi-stop directions link covering the whole
// optimized route, so "start driving" is one tap instead of one per stop.
export function buildGoogleMapsUrl(start, orderedStops) {
  if (orderedStops.length === 0) return '';
  const last = orderedStops[orderedStops.length - 1];
  const waypoints = orderedStops
    .slice(0, -1)
    .map((s) => `${s.lat},${s.lng}`)
    .join('|');
  const params = new URLSearchParams({
    api: '1',
    origin: `${start.lat},${start.lng}`,
    destination: `${last.lat},${last.lng}`,
  });
  if (waypoints) params.set('waypoints', waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
