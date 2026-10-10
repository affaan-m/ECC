'use strict';

// Passive, local event trail. Receipt hashes detect accidental changes to these
// bytes; they do not authenticate a producer, authorize a scope or prove delivery.
const crypto = require('node:crypto');
const { collisionRisk, DEFAULTS } = require('./distance');

const VERSION = 1;
const ZERO_HASH = '0'.repeat(64);
const MAX_RECEIPTS = 16;
function invalid() { throw new Error('Invalid shadow coordination input.'); }
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64) invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !Object.hasOwn(value, key) ||
        !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid();
  }
  return value;
}
function shape(value, allowed, required = allowed) {
  const row = object(value);
  if (Reflect.ownKeys(row).some(key => !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(row, key))) invalid();
  return row;
}
function array(value, max) {
  if (!Array.isArray(value) || value.length > max ||
      Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) invalid();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid();
  }
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || value.length > 120 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) ||
      ['__proto__', 'constructor', 'prototype'].includes(value)) invalid();
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
  return value;
}
function path(value) {
  if (typeof value !== 'string' || !value || value.length > 256 ||
      value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\') ||
      value.split('/').some(part => !part || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(part)) ||
      [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) invalid();
  return value;
}
function paths(value, max = 32) {
  array(value, max);
  const result = value.map(path);
  if (new Set(result).size !== result.length) invalid();
  return result.sort();
}
function observation(value) {
  const row = shape(value, ['agentId', 'taskId', 'repoId', 'baseRevision', 'scopeRevision',
    'footprint', 'readPaths', 'writePaths', 'observedAt', 'expiresAt']);
  if (typeof row.baseRevision !== 'string' || !/^[a-f0-9]{40}$/.test(row.baseRevision) ||
      !Number.isSafeInteger(row.scopeRevision) || row.scopeRevision < 1 ||
      !['complete', 'incomplete'].includes(row.footprint)) invalid();
  const observedAt = timestamp(row.observedAt);
  const expiresAt = timestamp(row.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) invalid();
  return { agentId: identifier(row.agentId), taskId: identifier(row.taskId),
    repoId: identifier(row.repoId), baseRevision: row.baseRevision,
    scopeRevision: row.scopeRevision, footprint: row.footprint,
    readPaths: paths(row.readPaths), writePaths: paths(row.writePaths), observedAt, expiresAt };
}
function pair(value) {
  array(value, 2);
  if (value.length !== 2) invalid();
  const result = value.map(observation).sort((a, b) => a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0);
  if (result[0].agentId === result[1].agentId) invalid();
  return result;
}
function graph(value = { adjacency: {} }) {
  const row = shape(value, ['adjacency']);
  const adjacency = object(row.adjacency);
  const entries = Object.entries(adjacency).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length > 64) invalid();
  const normalized = Object.create(null);
  let edgeCount = 0;
  for (const [name, edges] of entries) {
    edgeCount += Array.isArray(edges) ? edges.length : 257;
    if (edgeCount > 256) invalid();
    normalized[path(name)] = paths(edges, 16);
  }
  return { adjacency: normalized };
}
function sameTask(a, b) {
  return a.agentId === b.agentId && a.taskId === b.taskId &&
    a.repoId === b.repoId && a.baseRevision === b.baseRevision;
}
function intersection(a, b) { return a.some(item => b.includes(item)); }
function samePaths(a, b) { return a.length === b.length && a.every((item, index) => item === b[index]); }
function directHazard(a, b) {
  if (intersection(a.writePaths, b.writePaths)) return 'write-write';
  if (intersection(a.writePaths, b.readPaths) || intersection(b.writePaths, a.readPaths)) return 'write-read';
  return null;
}
function advisory(observations, dependencyGraph, at) {
  const [a, b] = observations;
  const hazard = directHazard(a, b);
  const aAll = [...new Set([...a.readPaths, ...a.writePaths])].sort();
  const bAll = [...new Set([...b.readPaths, ...b.writePaths])].sort();
  const first = collisionRisk({ files: a.writePaths.map(name => ({ path: name })) },
    { files: bAll.map(name => ({ path: name })) }, dependencyGraph).risk;
  const second = collisionRisk({ files: b.writePaths.map(name => ({ path: name })) },
    { files: aAll.map(name => ({ path: name })) }, dependencyGraph).risk;
  const risk = Math.max(first, second);
  let reason = null;
  if (a.repoId !== b.repoId || a.baseRevision !== b.baseRevision) reason = 'incomparable-context';
  else if (observations.some(item => Date.parse(item.observedAt) > Date.parse(at) ||
      Date.parse(item.expiresAt) <= Date.parse(at))) reason = 'stale-or-future-observation';
  else if (observations.some(item => item.footprint === 'incomplete')) reason = 'incomplete-footprint';
  const state = reason ? 'unknown' : hazard || risk >= DEFAULTS.thresholds.ta
    ? 'advisory' : 'no-advisory-in-scope';
  return { state, reason, hazard: reason === 'incomparable-context' ? null : hazard,
    heuristicRisk: risk, scoreKind: 'uncalibrated-three-channel-heuristic',
    authority: 'observation-only', outcome: 'unadjudicated' };
}
function encode(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) items.push(encode(value[index]));
    return `[${items.join(',')}]`;
  }
  if (!value || typeof value !== 'object') invalid();
  const fields = [];
  for (const key of Object.keys(value)) fields.push(`${JSON.stringify(key)}:${encode(value[key])}`);
  return `{${fields.join(',')}}`;
}
function digest(trailId, receipt, payload = receipt.payload) {
  const encoded = encode([VERSION, trailId, receipt.id, receipt.kind, receipt.at,
    receipt.previousHash, payload]);
  return crypto.createHash('sha256').update('ecc.tcas.shadow.v1\n').update(encoded).digest('hex');
}
function newReceipt(trail, id, kind, at, payload) {
  if (trail.receipts.length >= MAX_RECEIPTS) invalid();
  const previousHash = trail.receipts.at(-1)?.hash || ZERO_HASH;
  const row = { version: VERSION, id: identifier(id), kind, at: timestamp(at), previousHash, payload };
  return { ...row, hash: digest(trail.trailId, row) };
}
function extend(trail, id, kind, at, payload) {
  verifyShadowTrail(trail);
  const copied = copyTrail(trail);
  const next = { ...copied, receipts: [...copied.receipts, newReceipt(copied, id, kind, at, payload)] };
  verifyShadowTrail(next);
  return next;
}
function normalizePayload(kind, value) {
  if (kind === 'observation' || kind === 'reobservation') {
    const row = shape(value, ['observations', 'graph']);
    return { observations: pair(row.observations), graph: graph(row.graph) };
  }
  if (kind === 'advisory') {
    const row = shape(value, ['state', 'reason', 'hazard', 'heuristicRisk', 'scoreKind', 'authority', 'outcome']);
    if (!['unknown', 'advisory', 'no-advisory-in-scope'].includes(row.state) ||
        ![null, 'incomparable-context', 'stale-or-future-observation',
          'incomplete-footprint'].includes(row.reason) ||
        ![null, 'write-write', 'write-read'].includes(row.hazard) ||
        !Number.isFinite(row.heuristicRisk) || row.heuristicRisk < 0 || row.heuristicRisk > 1 ||
        row.scoreKind !== 'uncalibrated-three-channel-heuristic' ||
        row.authority !== 'observation-only' || row.outcome !== 'unadjudicated') invalid();
    return { state: row.state, reason: row.reason, hazard: row.hazard,
      heuristicRisk: row.heuristicRisk, scoreKind: row.scoreKind,
      authority: row.authority, outcome: row.outcome };
  }
  if (kind === 'acknowledgement') {
    const row = shape(value, ['agentId', 'scopeRevision', 'advisoryId']);
    if (!Number.isSafeInteger(row.scopeRevision) || row.scopeRevision < 1) invalid();
    return { agentId: identifier(row.agentId), scopeRevision: row.scopeRevision,
      advisoryId: identifier(row.advisoryId) };
  }
  if (kind === 'scope-revision') {
    const row = shape(value, ['agentId', 'taskId', 'repoId', 'baseRevision',
      'previousScopeRevision', 'newScopeRevision', 'newReadPaths', 'newWritePaths',
      'authorizationRef', 'authority']);
    if (typeof row.baseRevision !== 'string' || !/^[a-f0-9]{40}$/.test(row.baseRevision) ||
        !Number.isSafeInteger(row.previousScopeRevision) || row.previousScopeRevision < 1 ||
        !Number.isSafeInteger(row.newScopeRevision) || row.newScopeRevision <= row.previousScopeRevision ||
        row.authority !== 'declared-only') invalid();
    return { agentId: identifier(row.agentId), taskId: identifier(row.taskId),
      repoId: identifier(row.repoId), baseRevision: row.baseRevision,
      previousScopeRevision: row.previousScopeRevision, newScopeRevision: row.newScopeRevision,
      newReadPaths: paths(row.newReadPaths), newWritePaths: paths(row.newWritePaths),
      authorizationRef: identifier(row.authorizationRef), authority: row.authority };
  }
  invalid();
}
function copyTrail(trail) {
  return { version: VERSION, trailId: trail.trailId,
    receipts: trail.receipts.map(receipt => ({ version: receipt.version,
      id: receipt.id, kind: receipt.kind, at: receipt.at,
      previousHash: receipt.previousHash, payload: normalizePayload(receipt.kind, receipt.payload),
      hash: receipt.hash })) };
}
function transition(state, receipt) {
  const payload = normalizePayload(receipt.kind, receipt.payload);
  if (receipt.kind === 'observation') {
    if (state.observations) invalid();
    return { ...state, observations: payload.observations, graph: payload.graph, awaitingAdvisory: true };
  }
  if (receipt.kind === 'advisory') {
    if (!state.awaitingAdvisory || !state.observations) invalid();
    const expected = advisory(state.observations, state.graph, receipt.at);
    if (encode(payload) !== encode(expected)) invalid();
    return { ...state, latestAdvisory: expected, advisoryId: receipt.id,
      awaitingAdvisory: false, acknowledgements: [] };
  }
  if (state.awaitingAdvisory || !state.latestAdvisory) invalid();
  if (receipt.kind === 'acknowledgement') {
    if (state.latestAdvisory.state !== 'advisory' || state.scopeChange || state.reobserved ||
        payload.advisoryId !== state.advisoryId ||
        state.acknowledgements.includes(payload.agentId)) invalid();
    const member = state.observations.find(item => item.agentId === payload.agentId);
    if (!member || member.scopeRevision !== payload.scopeRevision ||
        Date.parse(member.expiresAt) <= Date.parse(receipt.at)) invalid();
    return { ...state, acknowledgements: [...state.acknowledgements, payload.agentId],
      acknowledgedBy: [...state.acknowledgedBy, payload.agentId] };
  }
  if (receipt.kind === 'scope-revision') {
    if (state.latestAdvisory.state !== 'advisory' || state.scopeChange ||
        state.reobserved || state.acknowledgements.length !== 2) invalid();
    const member = state.observations.find(item => item.agentId === payload.agentId);
    if (!member || !sameTask(member, payload) ||
        member.scopeRevision !== payload.previousScopeRevision ||
        state.observations.some(item => Date.parse(item.expiresAt) <= Date.parse(receipt.at) ||
          Date.parse(item.observedAt) > Date.parse(receipt.at))) invalid();
    return { ...state, scopeChange: { ...payload, at: receipt.at } };
  }
  if (receipt.kind === 'reobservation') {
    if (!state.scopeChange || state.reobserved) invalid();
    for (const member of payload.observations) {
      const old = state.observations.find(item => item.agentId === member.agentId);
      if (!old || !sameTask(old, member) ||
          member.scopeRevision !== (member.agentId === state.scopeChange.agentId
            ? state.scopeChange.newScopeRevision : old.scopeRevision) ||
          !samePaths(member.readPaths, member.agentId === state.scopeChange.agentId
            ? state.scopeChange.newReadPaths : old.readPaths) ||
          !samePaths(member.writePaths, member.agentId === state.scopeChange.agentId
            ? state.scopeChange.newWritePaths : old.writePaths) ||
          Date.parse(member.observedAt) < Date.parse(state.scopeChange.at)) invalid();
    }
    return { ...state, observations: payload.observations, graph: payload.graph,
      reobserved: true, awaitingAdvisory: true };
  }
  invalid();
}
function inspect(trail) {
  const row = shape(trail, ['version', 'trailId', 'receipts']);
  if (row.version !== VERSION) invalid();
  array(row.receipts, MAX_RECEIPTS);
  if (row.receipts.length < 2) invalid();
  identifier(row.trailId);
  let previousHash = ZERO_HASH;
  let previousAt = -Infinity;
  let state = { observations: null, awaitingAdvisory: false,
    acknowledgements: [], acknowledgedBy: [] };
  const ids = new Set();
  for (const receipt of row.receipts) {
    shape(receipt, ['version', 'id', 'kind', 'at', 'previousHash', 'payload', 'hash']);
    const id = identifier(receipt.id);
    const at = timestamp(receipt.at);
    const payload = normalizePayload(receipt.kind, receipt.payload);
    if (encode(receipt.payload) !== encode(payload)) invalid();
    if (receipt.version !== VERSION || ids.has(id) || Date.parse(at) < previousAt ||
        typeof receipt.previousHash !== 'string' || typeof receipt.hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(receipt.previousHash) ||
        !/^[a-f0-9]{64}$/.test(receipt.hash) ||
        receipt.previousHash !== previousHash || receipt.hash !== digest(row.trailId, receipt, payload)) invalid();
    state = transition(state, { ...receipt, payload });
    ids.add(id);
    previousAt = Date.parse(at);
    previousHash = receipt.hash;
  }
  if (state.awaitingAdvisory) invalid();
  return state;
}
function guard(fn) {
  try { return fn(); } catch { invalid(); }
}
function verifyShadowTrail(trail) { return guard(() => { inspect(trail); return true; }); }
function createShadowTrail(input) {
  const row = shape(input, ['trailId', 'observations', 'at', 'graph'],
    ['trailId', 'observations', 'at']);
  const trailId = identifier(row.trailId);
  const at = timestamp(row.at);
  const observations = pair(row.observations);
  const dependencyGraph = graph(row.graph);
  const blank = { version: VERSION, trailId, receipts: [] };
  const first = newReceipt(blank, `${trailId}:observation-0`, 'observation', at,
    { observations, graph: dependencyGraph });
  const partial = { ...blank, receipts: [first] };
  const second = newReceipt(partial, `${trailId}:advisory-0`, 'advisory', at,
    advisory(observations, dependencyGraph, at));
  const result = { ...blank, receipts: [first, second] };
  verifyShadowTrail(result);
  return result;
}
function appendAcknowledgement(trail, input) {
  const row = shape(input, ['id', 'agentId', 'scopeRevision', 'at']);
  const state = inspect(trail);
  return extend(trail, row.id, 'acknowledgement', row.at,
    { agentId: row.agentId, scopeRevision: row.scopeRevision, advisoryId: state.advisoryId });
}
function appendScopeRevision(trail, input) {
  const row = shape(input, ['id', 'agentId', 'previousScopeRevision',
    'newScopeRevision', 'newReadPaths', 'newWritePaths', 'authorizationRef', 'at']);
  const state = inspect(trail);
  const member = state.observations.find(item => item.agentId === row.agentId);
  if (!member) invalid();
  return extend(trail, row.id, 'scope-revision', row.at,
    { agentId: row.agentId, taskId: member.taskId, repoId: member.repoId,
      baseRevision: member.baseRevision, previousScopeRevision: row.previousScopeRevision,
      newScopeRevision: row.newScopeRevision, newReadPaths: paths(row.newReadPaths),
      newWritePaths: paths(row.newWritePaths), authorizationRef: row.authorizationRef,
      authority: 'declared-only' });
}
function appendReobservation(trail, input) {
  const row = shape(input, ['id', 'observations', 'at', 'graph'], ['id', 'observations', 'at']);
  const state = inspect(trail);
  const at = timestamp(row.at);
  const observations = pair(row.observations);
  const dependencyGraph = graph(row.graph === undefined ? state.graph : row.graph);
  if (trail.receipts.length > MAX_RECEIPTS - 2) invalid();
  const copied = copyTrail(trail);
  const first = newReceipt(copied, row.id, 'reobservation', at, { observations, graph: dependencyGraph });
  const partial = { ...copied, receipts: [...copied.receipts, first] };
  const second = newReceipt(partial, `${row.id}:advisory`, 'advisory', at,
    advisory(observations, dependencyGraph, at));
  const result = { ...copied, receipts: [...partial.receipts, second] };
  verifyShadowTrail(result);
  return result;
}
function summarizeShadowTrail(trail) {
  const state = inspect(trail);
  return { version: VERSION, mode: 'shadow-read-only', trailId: trail.trailId,
    receiptCount: trail.receipts.length, latestAdvisory: { ...state.latestAdvisory },
    latestAdvisoryId: state.advisoryId,
    latestAdvisoryAcknowledgedBy: [...state.acknowledgements].sort(),
    historicalAcknowledgedBy: [...new Set(state.acknowledgedBy)].sort(),
    scopeChange: state.scopeChange ? { ...state.scopeChange } : null,
    outcome: 'unadjudicated' };
}
module.exports = {
  createShadowTrail: input => guard(() => createShadowTrail(input)),
  appendAcknowledgement: (trail, input) => guard(() => appendAcknowledgement(trail, input)),
  appendScopeRevision: (trail, input) => guard(() => appendScopeRevision(trail, input)),
  appendReobservation: (trail, input) => guard(() => appendReobservation(trail, input)),
  verifyShadowTrail,
  summarizeShadowTrail: trail => guard(() => summarizeShadowTrail(trail))
};
