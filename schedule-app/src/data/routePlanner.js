import { distanceMeters, timeToMinutes, minutesToTime } from './helpers.js';
import { travelMinutes } from './conflicts.js';

// Greedy nearest-neighbor route ordering — a lightweight, fully offline
// heuristic (no routing API, no paid service, no network dependency) that
// orders a set of stops starting from `start` by always jumping to the
// closest remaining stop in a straight line. It's not true shortest-path
// (that needs real road data and is NP-hard to solve exactly anyway), but
// it's a solid, zero-cost approximation of "what order should I visit these
// in" — turn-by-turn driving directions for the resulting order still come
// from Google Maps (see buildGoogleMapsUrl below).
// Stops that come from a calendar event have a fixed start time — you can't
// reorder your way out of a 2pm appointment. So those are pinned in clock
// order and act as anchors; the free stops (saved pins, people to visit) are
// slotted into the gaps around them by nearest-neighbour. Ordering purely by
// distance, as this used to, would happily route you to a 5pm event before a
// 9am one just because it was closer.
export function optimizeRoute(start, stops) {
  const timed = stops
    .filter((s) => s.start)
    .sort((a, b) => a.start.localeCompare(b.start));
  const free = stops.filter((s) => !s.start);

  const ordered = [];
  let current = start;
  let totalMeters = 0;

  const push = (stop) => {
    const legMeters = distanceMeters(current.lat, current.lng, stop.lat, stop.lng);
    ordered.push({ ...stop, legMeters });
    totalMeters += legMeters;
    current = stop;
  };

  // Nearest remaining free stop to wherever we are now.
  const takeNearestFree = () => {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < free.length; i++) {
      const d = distanceMeters(current.lat, current.lng, free[i].lat, free[i].lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx === -1 ? null : free.splice(bestIdx, 1)[0];
  };

  if (timed.length === 0) {
    let next;
    while ((next = takeNearestFree())) push(next);
    return withSchedule({ stops: ordered, totalMeters });
  }

  // Walk the fixed appointments in order, filling each gap beforehand with
  // as many free stops as there is room for.
  for (const anchor of timed) {
    let budget = timeToMinutes(anchor.start) - clockAt(ordered, start);
    let next;
    while (free.length > 0) {
      const candidate = free[nearestIdx(current, free)];
      const legMin = travelMinutes(distanceMeters(current.lat, current.lng, candidate.lat, candidate.lng));
      const onwardMin = travelMinutes(distanceMeters(candidate.lat, candidate.lng, anchor.lat, anchor.lng));
      const directMin = travelMinutes(distanceMeters(current.lat, current.lng, anchor.lat, anchor.lng));
      // Only detour via this stop if doing so still leaves time to reach the
      // appointment; VISIT_MINUTES covers actually being there.
      if (legMin + VISIT_MINUTES + onwardMin > budget && directMin <= budget) break;
      next = takeNearestFree();
      push(next);
      budget = timeToMinutes(anchor.start) - clockAt(ordered, start);
    }
    push(anchor);
  }
  // Anything that didn't fit before an appointment goes after the last one.
  let next;
  while ((next = takeNearestFree())) push(next);

  return withSchedule({ stops: ordered, totalMeters });
}

// How long you're actually at a stop before moving on. A visit that takes
// zero time would make every "leave by" wildly optimistic.
const VISIT_MINUTES = 20;

function nearestIdx(from, list) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = distanceMeters(from.lat, from.lng, list[i].lat, list[i].lng);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Clock time (minutes since midnight) you'd be free again after the stops
// ordered so far — travel plus a visit at each.
function clockAt(ordered, start) {
  let t = start.departAt != null ? start.departAt : nowMinutes();
  for (const s of ordered) {
    t += travelMinutes(s.legMeters) + VISIT_MINUTES;
    // An appointment you arrive early for still doesn't end before it starts.
    if (s.start) t = Math.max(t, timeToMinutes(s.start) + VISIT_MINUTES);
  }
  return t;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Walks the ordered route once more to attach, for each stop, the time you'd
// need to leave the previous one and the time you'd arrive. This is the bit
// that turns "visit these in this order" into a plan you can actually
// follow — an order with no clock attached still leaves you guessing when to
// walk out the door.
function withSchedule(route) {
  let t = nowMinutes();
  const stops = route.stops.map((s) => {
    const travel = travelMinutes(s.legMeters);
    const leaveAt = t;
    let arriveAt = t + travel;
    // For a fixed appointment, show the latest you can leave and still make
    // it, not the earliest you could turn up and wait.
    if (s.start) {
      const due = timeToMinutes(s.start);
      if (arriveAt < due) {
        arriveAt = due;
        t = due - travel;
      }
    }
    const out = {
      ...s,
      travelMinutes: travel,
      leaveAt: minutesToTime(clamp(Math.round(t), 0, 24 * 60 - 1)),
      arriveAt: minutesToTime(clamp(Math.round(arriveAt), 0, 24 * 60 - 1)),
      // True when the plan can't get you there in time no matter what.
      late: s.start ? leaveAt + travel > timeToMinutes(s.start) : false,
    };
    t = arriveAt + VISIT_MINUTES;
    return out;
  });
  return { ...route, stops };
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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
