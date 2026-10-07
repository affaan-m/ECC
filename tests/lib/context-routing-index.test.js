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
  assert.deepEqual(Object.keys(index.entries[0]).sort(), ['description', 'id', 'name', 'ownerModuleId', 'packId']);
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
