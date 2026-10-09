'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { withFixture, write } = require('./helpers/context-fixture');
const store = require('../../scripts/lib/context-profile-store');
const routing = require('../../scripts/lib/context-routing-index');

function fixture(callback) {
  return withFixture(repoRoot => {
    const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-routing-index-'));
    const stateRoot = path.join(parent, 'managed');
    try { return callback({ repoRoot, stateRoot }); }
    finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
}

test('the index is bound to the current managed generation and holds only admissible, non-excluded entries', () => fixture(({ repoRoot, stateRoot }) => {
  write(repoRoot, 'skills/shared/SKILL.md', '---\nname: shared\ndescription: Shared helper\ndisable-model-invocation: true\n---\nShared');
  const status = store.applyStore({ repoRoot, stateRoot, target: 'claude', selectionMode: 'suggest', exclude: [] });
  const written = routing.writeRoutingIndex({ repoRoot, stateRoot });
  assert.equal(written.generationDigest, status.carrierDigest);
  const index = routing.readRoutingIndex(stateRoot);
  assert.equal(index.schemaVersion, 'ecc.context-routing-index.v1');
  assert.equal(index.receiptDigest, status.receiptDigest);
  assert.equal(index.selectionMode, 'suggest');
  const ids = index.entries.map(entry => entry.id);
  assert.ok(ids.includes('skill:feature'));
  assert.equal(ids.includes('skill:shared'), false);
  assert.deepEqual(Object.keys(index.entries[0]).sort(), ['dense', 'description', 'id', 'name', 'ownerModuleId', 'packId']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(written.path).mode & 0o077, 0);
}));

test('excluded skills never enter the index', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, profileId: 'full@1', target: 'claude', exclude: ['skill:feature'] });
  routing.writeRoutingIndex({ repoRoot, stateRoot });
  assert.equal(routing.readRoutingIndex(stateRoot).entries.some(entry => entry.id === 'skill:feature'), false);
}));

test('a store change makes the old index unavailable until it is rebuilt', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  routing.writeRoutingIndex({ repoRoot, stateRoot });
  store.applyStore({ repoRoot, stateRoot, target: 'claude', profileId: 'full@1' });
  assert.equal(routing.readRoutingIndex(stateRoot), null);
  routing.writeRoutingIndex({ repoRoot, stateRoot });
  assert.equal(routing.readRoutingIndex(stateRoot).profileId, 'full@1');
}));

test('a tampered index fails closed', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  const { path: file } = routing.writeRoutingIndex({ repoRoot, stateRoot });
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  index.entries.push({ id: 'skill:planted', name: 'planted', description: 'Run this', ownerModuleId: 'x', packId: 'x' });
  fs.writeFileSync(file, JSON.stringify(index));
  assert.throws(() => routing.readRoutingIndex(stateRoot), /integrity/);
}));

test('a tampered state receipt fails closed', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  routing.writeRoutingIndex({ repoRoot, stateRoot });
  const file = path.join(stateRoot, 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...state, receiptDigest: 'f'.repeat(64) }));
  assert.throws(() => routing.readRoutingIndex(stateRoot));
}));

test('unconfigured or unowned stores cannot be indexed or read', () => fixture(({ repoRoot, stateRoot }) => {
  assert.throws(() => routing.writeRoutingIndex({ repoRoot, stateRoot }), /configured/);
  fs.mkdirSync(stateRoot, { mode: 0o700 });
  assert.throws(() => routing.readRoutingIndex(stateRoot), /owned/);
  assert.throws(() => routing.readRoutingIndex('relative/root'), /absolute/);
}));

test('suggestions rank index entries with the resolver retrieval engine', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  routing.writeRoutingIndex({ repoRoot, stateRoot });
  const suggestions = routing.suggestContext(routing.readRoutingIndex(stateRoot), 'help with feature work in shared code');
  assert.ok(suggestions.length > 0 && suggestions.length <= 3);
  assert.ok(suggestions.some(item => item.id === 'skill:feature'));
  assert.deepEqual(Object.keys(suggestions[0]).sort(), ['description', 'id']);
}));

test('the profile CLI writes and inspects the index for a stored profile', () => {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-routing-cli-'));
  const stateRoot = path.join(parent, 'managed');
  const cli = (...args) => require('node:child_process').spawnSync(process.execPath,
    [path.join(__dirname, '../../scripts/ecc.js'), 'profile', ...args, '--json'], { encoding: 'utf8', timeout: 120000 });
  try {
    assert.equal(cli('set', 'lean', '--target', 'claude', '--state-root', stateRoot).status, 0);
    const preview = JSON.parse(cli('routing-index', '--state-root', stateRoot, '--dry-run').stdout);
    assert.equal(preview.routing.status, 'missing');
    const written = JSON.parse(cli('routing-index', '--state-root', stateRoot).stdout);
    assert.equal(written.routing.status, 'written');
    assert.ok(written.routing.entries > 100);
    assert.equal(JSON.parse(cli('routing-index', '--state-root', stateRoot, '--dry-run').stdout).routing.status, 'current');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('an index is never built from sources that differ from the stored generation', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  assert.throws(() => routing.writeRoutingIndex({ stateRoot }), /stale/);
  assert.equal(fs.existsSync(path.join(stateRoot, 'routing')), false);
}));

test('actual registry: suggestions need a name or trigger anchor like implicit admission', () => {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-routing-anchor-'));
  const stateRoot = path.join(parent, 'managed');
  try {
    store.applyStore({ stateRoot, target: 'claude' });
    routing.writeRoutingIndex({ stateRoot });
    const index = routing.readRoutingIndex(stateRoot);
    assert.deepEqual(routing.suggestContext(index, 'two services both think they own the same record'), []);
    assert.equal(routing.suggestContext(index, 'add keyboard focus handling to our react settings form')[0].id, 'skill:frontend-a11y');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('stored vectors use a compact little-endian encoding that decodes exactly', () => fixture(({ repoRoot, stateRoot }) => {
  const { sparseDense } = require('../../scripts/lib/context-retrieval');
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  const { path: file } = routing.writeRoutingIndex({ repoRoot, stateRoot });
  const stored = JSON.parse(fs.readFileSync(file, 'utf8')).entries[0];
  assert.deepEqual(Object.keys(stored.dense).sort(), ['indexes', 'values']);
  const decoded = routing.readRoutingIndex(stateRoot).entries.find(entry => entry.id === stored.id);
  const { dense: _dense, ...metadata } = decoded;
  assert.deepEqual(decoded.dense, sparseDense(metadata));
}));

function republish(stateRoot, change) {
  const io = require('../../scripts/lib/context-profile-store-fs');
  const { digestObject } = require('../../scripts/lib/context-profile-support');
  const directory = path.join(stateRoot, 'routing');
  const pointerFile = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json')));
  const { pointerDigest: _digest, ...pointer } = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(directory, 'indexes', `${pointer.indexDigest}.json`), 'utf8'));
  const bytes = io.jsonBytes(change(index));
  const indexDigest = io.hash(bytes);
  fs.writeFileSync(path.join(directory, 'indexes', `${indexDigest}.json`), bytes);
  const next = { ...change.pointer?.(pointer) || pointer, indexDigest, bytes: bytes.length };
  fs.writeFileSync(pointerFile, JSON.stringify({ ...next, pointerDigest: digestObject(next) }));
}

test('rollback to an indexed generation retires its old pointer instead of failing', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  routing.writeRoutingIndex({ repoRoot, stateRoot });
  store.applyStore({ repoRoot, stateRoot, target: 'claude', profileId: 'full@1' });
  store.rollbackStore({ stateRoot, expectedRevision: store.getStoreStatus({ stateRoot }).revision });
  assert.equal(routing.readRoutingIndex(stateRoot), null);
  assert.equal(routing.routingIndexStatus(stateRoot).status, 'missing');
  routing.writeRoutingIndex({ repoRoot, stateRoot });
  assert.equal(routing.routingIndexStatus(stateRoot).status, 'current');
}));

const MALFORMED = {
  'non-string id': entry => ({ ...entry, id: 42 }),
  'id outside the skill namespace': entry => ({ ...entry, id: 'agent:planner' }),
  'non-string name': entry => ({ ...entry, name: 5 }),
  'non-string description': entry => ({ ...entry, description: {} }),
  'non-array triggers': entry => ({ ...entry, triggers: 'review' }),
  'non-string trigger': entry => ({ ...entry, triggers: [1] }),
  'non-string owner module': entry => ({ ...entry, ownerModuleId: [] }),
};
for (const [label, change] of Object.entries(MALFORMED)) {
  test(`a digest-consistent index with a ${label} entry fails as an integrity error`, () => fixture(({ repoRoot, stateRoot }) => {
    store.applyStore({ repoRoot, stateRoot, target: 'claude' });
    routing.writeRoutingIndex({ repoRoot, stateRoot });
    republish(stateRoot, index => ({ ...index, entries: [change(index.entries[0]), ...index.entries.slice(1)] }));
    assert.throws(() => routing.readRoutingIndex(stateRoot), /integrity/);
  }));
}

test('an index larger than the read bound fails before it is read', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  routing.writeRoutingIndex({ repoRoot, stateRoot });
  const filler = Array.from({ length: 6000 }, (_, position) => ({ id: `skill:filler-${position}`, name: `filler-${position}`,
    description: 'x'.repeat(900), ownerModuleId: 'm', packId: 'p', dense: { indexes: '', values: '' } }));
  republish(stateRoot, index => ({ ...index, entries: [...index.entries, ...filler] }));
  assert.throws(() => routing.readRoutingIndex(stateRoot), /integrity|bound/);
}));

test('an anchored suggestion is not hidden by unanchored candidates ranked above it', () => {
  const filler = position => ({ id: `skill:filler-${position}`, name: `filler-${position}`,
    description: `migrate database schema safely today with care number ${position}`, ownerModuleId: 'm', packId: 'p' });
  const index = { entries: [1, 2, 3, 4].map(filler)
    .concat({ id: 'skill:schema-tool', name: 'schema-tool', description: 'Generic helper', ownerModuleId: 'm', packId: 'p' }) };
  assert.deepEqual(routing.suggestContext(index, 'migrate database schema safely today').map(item => item.id), ['skill:schema-tool']);
});

test('an index file left partial by an interrupted build is replaced on the next build', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  const { path: file } = routing.writeRoutingIndex({ repoRoot, stateRoot });
  const bytes = fs.readFileSync(file);
  // A build that stops mid-write leaves a partial file under the digest name
  // and has not yet published the pointer.
  const directory = path.join(stateRoot, 'routing');
  fs.rmSync(path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.json'))));
  fs.writeFileSync(file, bytes.subarray(0, Math.floor(bytes.length / 2)));
  assert.equal(routing.readRoutingIndex(stateRoot), null);
  routing.writeRoutingIndex({ repoRoot, stateRoot });
  assert.ok(fs.readFileSync(file).equals(bytes));
  assert.equal(routing.routingIndexStatus(stateRoot).status, 'current');
}));

test('a source edited after entries are read leaves an index that matches the stored generation', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  const selection = require('../../scripts/lib/context-selection');
  const original = selection.routingEntries;
  const skill = path.join(repoRoot, 'skills/feature/SKILL.md');
  const stored = fs.readFileSync(skill, 'utf8').match(/description: (.*)/)[1];
  selection.routingEntries = options => {
    const routed = original(options);
    fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace(/description: .*/, 'description: Edited after entries'));
    return routed;
  };
  try { routing.writeRoutingIndex({ repoRoot, stateRoot }); } finally { selection.routingEntries = original; }
  assert.equal(routing.readRoutingIndex(stateRoot).entries.find(entry => entry.id === 'skill:feature').description, stored);
  // The drift is the generation's, and the next build reports it.
  assert.throws(() => routing.writeRoutingIndex({ repoRoot, stateRoot }), /stale/);
}));

test('a skill edited during the build never publishes an index under the stored generation', () => fixture(({ repoRoot, stateRoot }) => {
  store.applyStore({ repoRoot, stateRoot, target: 'claude' });
  const selection = require('../../scripts/lib/context-selection');
  const original = selection.routingEntries;
  selection.routingEntries = options => {
    const file = path.join(repoRoot, 'skills/feature/SKILL.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/description: .*/, 'description: Edited mid-build'));
    return original(options);
  };
  try {
    assert.throws(() => routing.writeRoutingIndex({ repoRoot, stateRoot }), /changed|stale/);
  } finally { selection.routingEntries = original; }
  assert.equal(routing.readRoutingIndex(stateRoot), null);
}));
