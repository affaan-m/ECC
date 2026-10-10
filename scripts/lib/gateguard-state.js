'use strict';

// --- Counters ---
// see docs/gateguard/design-notes.md#state-file-is-untrusted

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function getDenialCount(state) {
  return toCount(state && state.fact_force_denials);
}

function getCreditedCount(state) {
  return toCount(state && state.fact_force_credited);
}

function getCapAllowCount(state) {
  return toCount(state && state.cap_allows);
}

function getTrivialAllowCount(state) {
  return toCount(state && state.trivial_allows);
}

function getRoutineReadonlyPassCount(state) {
  return toCount(state && state.routine_readonly_passes);
}

// --- Sibling dir gates ---

const MAX_DIR_GATES = 50;
const DIR_GATE_KEY_SEPARATOR = '\u0000';
const UNSAFE_MAP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeKey(key) {
  return typeof key === 'string' && key !== '' && !UNSAFE_MAP_KEYS.has(key);
}

function nullMap(entries) {
  const map = Object.create(null);
  for (const [key, value] of entries) map[key] = value;
  return map;
}

function withEntry(map, key, value) {
  return nullMap([...Object.entries(map), [key, value]]);
}

function getClassCounts(state, field) {
  const raw = state && state[field];
  if (!isPlainObject(raw)) return nullMap([]);
  const entries = Object.keys(raw)
    .filter(cls => isSafeKey(cls) && typeof raw[cls] === 'number' && toCount(raw[cls]) > 0)
    .map(cls => [cls, toCount(raw[cls])]);
  return nullMap(entries);
}

function mergeClassCounts(a, b) {
  const merged = nullMap(Object.entries(a));
  for (const [cls, n] of Object.entries(b)) {
    merged[cls] = Math.max(Object.hasOwn(merged, cls) ? merged[cls] : 0, n);
  }
  return merged;
}

function incrementClassCount(counts, cls) {
  if (!isSafeKey(cls)) return counts;
  return withEntry(counts, cls, (Object.hasOwn(counts, cls) ? counts[cls] : 0) + 1);
}

function getSiblingAllowCount(state) {
  return toCount(state && state.sibling_allows);
}

function dirGateKey(cls, dir) {
  return `${cls}${DIR_GATE_KEY_SEPARATOR}${dir}`;
}

function isDirGateKey(key) {
  if (!isSafeKey(key)) return false;
  const at = key.indexOf(DIR_GATE_KEY_SEPARATOR);
  return at > 0 && at < key.length - 1 && require('./gateguard-target-class').COLLAPSIBLE_CLASSES.has(key.slice(0, at));
}

function isDirGateEntry(entry) {
  return (
    isPlainObject(entry) &&
    typeof entry.at === 'number' &&
    Number.isFinite(entry.at) &&
    typeof entry.first === 'string' &&
    (entry.turn === null || entry.turn === undefined || typeof entry.turn === 'string')
  );
}

function getDirGates(state) {
  const raw = state && state.dir_gates;
  if (!isPlainObject(raw)) return nullMap([]);
  const entries = Object.keys(raw)
    .filter(key => isDirGateKey(key) && isDirGateEntry(raw[key]))
    .map(key => {
      const entry = raw[key];
      return [key, { turn: entry.turn || null, at: entry.at, first: entry.first, ordinal: toCount(entry.ordinal) }];
    });
  return nullMap(entries);
}

/** Merge two dir-gate maps; the newer `at` wins per key. */
function mergeDirGates(older, newer) {
  const merged = nullMap(Object.entries(older));
  for (const [key, entry] of Object.entries(newer)) {
    if (!Object.hasOwn(merged, key) || entry.at >= merged[key].at) merged[key] = entry;
  }
  return merged;
}

function capDirGates(gates) {
  const entries = Object.entries(gates);
  if (entries.length <= MAX_DIR_GATES) return gates;
  return nullMap(entries.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_DIR_GATES));
}

module.exports = {
  getDenialCount,
  getCreditedCount,
  getCapAllowCount,
  getTrivialAllowCount,
  getRoutineReadonlyPassCount,
  getSiblingAllowCount,
  getClassCounts,
  mergeClassCounts,
  incrementClassCount,
  withEntry,
  dirGateKey,
  getDirGates,
  mergeDirGates,
  capDirGates
};
