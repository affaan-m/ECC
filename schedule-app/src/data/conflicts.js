import { distanceMeters, timeToMinutes, formatTime } from './helpers.js';

// Catches the two mistakes a day plan can contain that the planner is in a
// position to notice on the user's behalf: two things booked at once, and two
// things booked in places you cannot physically get between in time.
//
// Everything here is straight-line and offline, matching how routePlanner.js
// already estimates distance — no routing API, no network, no cost. That
// makes the numbers approximate, so the thresholds below are deliberately
// forgiving: this should catch "you booked across town with ten minutes to
// spare", not quibble over a two-minute walk.

// Straight line under-measures real travel, since roads bend and one-way
// systems exist. 1.35 is the usual rule-of-thumb correction.
const DETOUR_FACTOR = 1.35;
// Average door-to-door speed for a mixed urban trip, in metres per minute
// (30 km/h). Slower than a highway, faster than walking — and it is the
// average that matters here, including parking and lights.
const METRES_PER_MINUTE = 500;
// Below this the two places are effectively the same one (different rooms in
// a building, adjacent addresses), so a gap of zero is not a problem.
const SAME_PLACE_METRES = 150;
// Only flag a trip that misses by more than this. Absorbs the error in a
// straight-line estimate rather than nagging about every tight connection.
const GRACE_MINUTES = 5;

export function travelMinutes(meters) {
  return Math.round((meters * DETOUR_FACTOR) / METRES_PER_MINUTE);
}

// Where an event actually is. Events carry coordinates directly once someone
// has picked a spot on the map; failing that, an event attached to a person
// happens at that person's address, which the app has already dropped a pin
// for. A free-text `location` with neither is unusable here — we can't
// geocode offline, and guessing would produce false alarms.
export function eventCoords(event, state) {
  if (typeof event.locLat === 'number' && typeof event.locLng === 'number') {
    return { lat: event.locLat, lng: event.locLng };
  }
  if (event.contactId) {
    const pin = (state.pins || []).find(
      (p) => p.contactId === event.contactId && p.source === 'contact-address'
    );
    if (pin && typeof pin.lat === 'number' && typeof pin.lng === 'number') {
      return { lat: pin.lat, lng: pin.lng };
    }
  }
  return null;
}

const label = (occ) => occ.title || 'Untitled';

// `occurrences` is the already-expanded list for one day, as produced by
// PlannerPage's occurrencesFor() — each carries `s`/`e2` start/end minutes.
export function findDayConflicts(occurrences, state) {
  const timed = occurrences
    .filter((o) => Number.isFinite(o.s) && Number.isFinite(o.e2) && o.e2 > o.s)
    .sort((a, b) => a.s - b.s || a.e2 - b.e2);
  const out = [];

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];

      if (a.s < b.e2 && b.s < a.e2) {
        out.push({
          id: `overlap:${a.id}:${a.recDate || ''}:${b.id}:${b.recDate || ''}`,
          kind: 'overlap',
          a,
          b,
          text: `"${label(a)}" and "${label(b)}" overlap`,
          detail: `${formatTime(a.start)}–${formatTime(a.end)} vs ${formatTime(b.start)}–${formatTime(b.end)}`,
        });
        continue;
      }

      // Sorted by start, so the first non-overlapping `b` is the next event;
      // anything after it is further away in time and can only be easier to
      // reach. Checking just that pair keeps this to one warning per gap.
      if (b.s < a.e2) continue;
      const isNext = !timed.some((o) => o !== a && o !== b && o.s >= a.e2 && o.s < b.s);
      if (!isNext) break;

      const from = eventCoords(a, state);
      const to = eventCoords(b, state);
      if (!from || !to) break;

      const meters = distanceMeters(from.lat, from.lng, to.lat, to.lng);
      if (meters < SAME_PLACE_METRES) break;

      const needed = travelMinutes(meters);
      const gap = b.s - a.e2;
      if (needed > gap + GRACE_MINUTES) {
        out.push({
          id: `travel:${a.id}:${a.recDate || ''}:${b.id}:${b.recDate || ''}`,
          kind: 'travel',
          a,
          b,
          meters,
          needed,
          gap,
          text: `Not enough time to get from "${label(a)}" to "${label(b)}"`,
          detail: `about ${needed} min of travel, ${gap === 0 ? 'no gap' : `only ${gap} min`} between them`,
        });
      }
      break;
    }
  }

  return out;
}

// Convenience for callers that hold raw events rather than occurrences.
export function findConflictsOnDate(events, iso, state, expand) {
  const occ = events
    .flatMap((e) => expand(e, iso))
    .map((o) => ({ ...o, s: timeToMinutes(o.start), e2: timeToMinutes(o.end) }));
  return findDayConflicts(occ, state);
}
