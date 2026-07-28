import { distanceMeters, timeToMinutes, minutesToTime } from './helpers.js';
import { travelMinutes, roadMeters } from './conflicts.js';

// How long you're at a stop that doesn't say otherwise. A calendar event
// knows its own length and uses that instead; this is only the guess for a
// saved pin or a person you're dropping in on.
const DEFAULT_VISIT_MINUTES = 20;

// Orders a day's stops and attaches a clock to them.
//
// Two kinds of stop, and the difference is the whole design:
//   - A calendar event has a fixed start (and a real duration). You can't
//     reorder your way out of a 2pm appointment, so these are pinned in
//     clock order and act as anchors.
//   - Everything else — saved pins, people to visit — is free to move, and
//     gets slotted into the gaps around the anchors by nearest-neighbour.
//
// Ordering purely by distance, as the first version did, would happily send
// you to a 5pm event before a 9am one because it was closer.
//
// `departAt` (minutes since midnight) is when you're setting off. It's a
// parameter rather than a read of the wall clock so the result is a pure
// function of its inputs — the previous version consulted `new Date()` in
// two separate places, which made it untestable and meant the packing pass
// and the scheduling pass could disagree across a minute boundary.
export function optimizeRoute(start, stops, { departAt = nowMinutes() } = {}) {
  const timed = stops.filter((s) => s.start).sort((a, b) => a.start.localeCompare(b.start));
  const free = stops.filter((s) => !s.start);

  const ordered = [];
  let current = start;
  let totalMeters = 0;
  // Running clock, advanced as stops are committed. Kept here rather than
  // recomputed from scratch per candidate (which the old version did, and
  // which made it O(n²) as well as easy to get out of step).
  let clock = departAt;

  const push = (stop) => {
    const legMeters = distanceMeters(current.lat, current.lng, stop.lat, stop.lng);
    ordered.push({ ...stop, legMeters });
    totalMeters += legMeters;
    current = stop;
    const arrive = stop.start
      ? Math.max(clock + travelMinutes(legMeters), timeToMinutes(stop.start))
      : clock + travelMinutes(legMeters);
    clock = arrive + visitLength(stop);
  };

  const takeNearestFree = () => {
    if (free.length === 0) return null;
    return free.splice(nearestIdx(current, free), 1)[0];
  };

  if (timed.length === 0) {
    let next;
    while ((next = takeNearestFree())) push(next);
    return withSchedule({ stops: ordered, totalMeters }, departAt);
  }

  // Walk the appointments in order, filling the gap before each with as many
  // free stops as actually fit.
  for (const anchor of timed) {
    while (free.length > 0) {
      const candidate = free[nearestIdx(current, free)];
      const legMin = travelMinutes(distanceMeters(current.lat, current.lng, candidate.lat, candidate.lng));
      const onwardMin = travelMinutes(
        distanceMeters(candidate.lat, candidate.lng, anchor.lat, anchor.lng)
      );
      const directMin = travelMinutes(distanceMeters(current.lat, current.lng, anchor.lat, anchor.lng));
      const due = timeToMinutes(anchor.start);
      const viaDetour = clock + legMin + visitLength(candidate) + onwardMin;
      // Take the detour only if it still gets you to the appointment on
      // time. If you already can't make it directly, one more stop won't
      // change that, so don't use lateness as licence to add more.
      if (viaDetour > due) break;
      if (clock + directMin > due) break;
      push(takeNearestFree());
    }
    push(anchor);
  }
  // Whatever didn't fit before an appointment goes after the last one.
  let next;
  while ((next = takeNearestFree())) push(next);

  return withSchedule({ stops: ordered, totalMeters }, departAt);
}

// How long a stop takes. An event's real duration matters: treating a
// 10:00–11:00 appointment as a 20-minute errand made every departure time
// after it forty minutes optimistic, which is exactly the sort of quietly
// wrong number that makes a plan worse than no plan.
function visitLength(stop) {
  if (stop.start && stop.end) {
    const mins = timeToMinutes(stop.end) - timeToMinutes(stop.start);
    if (mins > 0) return mins;
  }
  return DEFAULT_VISIT_MINUTES;
}

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

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Second pass over the committed order, attaching the times you'd actually
// read off the screen: when to leave, when you'd arrive, and how long you're
// waiting around if you get somewhere early.
//
// Times are carried as raw minutes from midnight and allowed to exceed 1440.
// They used to be clamped into the day, which meant a plan running past
// midnight reported "arrive 23:59, leave 23:59, arrive 23:59" — three
// different stops all showing the same wrong time, and no way to tell the
// plan had overrun at all. Formatting wraps them and flags the day roll
// instead, so a late run reads as 12:05 AM (+1d).
function withSchedule(route, departAt) {
  let free = departAt; // when you're next available to set off
  const stops = route.stops.map((s) => {
    const travel = travelMinutes(s.legMeters);
    const earliestArrival = free + travel;
    let leaveAt = free;
    let arriveAt = earliestArrival;
    let waitMinutes = 0;

    if (s.start) {
      const due = timeToMinutes(s.start);
      if (earliestArrival <= due) {
        // You'd get there early. Report the latest you can leave and still
        // make it — that's the number worth acting on — and call out the
        // slack separately rather than burying it as a mystery gap.
        arriveAt = due;
        leaveAt = due - travel;
        waitMinutes = leaveAt - free;
      }
    }

    const out = {
      ...s,
      // Ordering is done on straight-line geometry, but the number on screen
      // should be the distance you'd drive — the same basis the times use.
      legMeters: roadMeters(s.legMeters),
      travelMinutes: travel,
      visitMinutes: visitLength(s),
      leaveAt: clockLabel(leaveAt),
      arriveAt: clockLabel(arriveAt),
      // True when this stop happens after midnight, so the UI can say so
      // rather than quietly showing an early-morning time in today's plan.
      nextDay: arriveAt >= 24 * 60,
      // Free time before you need to set off for this stop.
      waitMinutes: Math.max(0, Math.round(waitMinutes)),
      // Can't be reached in time however you drive it.
      late: s.start ? earliestArrival > timeToMinutes(s.start) : false,
      lateBy: s.start ? Math.max(0, Math.round(earliestArrival - timeToMinutes(s.start))) : 0,
    };
    free = arriveAt + visitLength(s);
    return out;
  });
  return {
    ...route,
    stops,
    totalMeters: roadMeters(route.totalMeters),
    departAt,
    endsAt: clockLabel(free),
    endsNextDay: free >= 24 * 60,
  };
}

// Minutes from midnight to an "HH:MM" label, wrapping rather than clamping so
// 25:05 reads as 00:05 rather than being pinned to the end of the day.
function clockLabel(mins) {
  const m = ((Math.round(mins) % (24 * 60)) + 24 * 60) % (24 * 60);
  return minutesToTime(m);
}

export function formatDistance(meters) {
  const miles = meters / 1609.34;
  return miles < 0.1 ? `${Math.round(meters)} m` : `${miles.toFixed(1)} mi`;
}

export function formatMinutes(mins) {
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
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
