'use strict';
// Deterministic event log: 300,000 events from a seeded LCG so every run,
// grader, and reference sees identical data. Do not change the generator.
const TYPES = ['click', 'view', 'signup', 'purchase', 'refund', 'login',
  'logout', 'share', 'comment', 'like', 'search', 'export'];
const DAY_MS = 86400000;
const EPOCH_MS = 1754000000000;
const SPAN_MS = 90 * DAY_MS;

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const rand = lcg(20260925);
const events = new Array(300000);
for (let i = 0; i < events.length; i++) {
  events[i] = {
    type: TYPES[Math.floor(rand() * TYPES.length)],
    ts: EPOCH_MS + Math.floor(rand() * SPAN_MS),
    value: Math.floor(rand() * 50000) + 1,
  };
}

module.exports = { events, TYPES, EPOCH_MS, SPAN_MS };
