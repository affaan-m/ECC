'use strict';
/**
 * Tests for scripts/work-items.js — focused on the `claim` JIT pickup command.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { createStateStore } = require('../../scripts/lib/state-store');

const CLI = path.join(__dirname, '..', '..', 'scripts', 'work-items.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function runClaim(dbPath, args) {
  const result = spawnSync('node', [CLI, 'claim', '--db', dbPath, '--json', ...args], {
    encoding: 'utf8'
  });
  return result;
}

async function seed(dbPath) {
  const store = await createStateStore({ dbPath });
  try {
    // High-priority, unassigned, open — the JIT pickup target.
    store.upsertWorkItem({
      id: 'wi-unassigned-high',
      source: 'github-issue',
      title: 'Fix the gate bypass',
      status: 'open',
      priority: 'high',
      owner: null,
      metadata: {}
    });
    // Low-priority, unassigned, open — should be picked only after the high one.
    store.upsertWorkItem({
      id: 'wi-unassigned-low',
      source: 'manual',
      title: 'Tidy docs',
      status: 'open',
      priority: 'low',
      owner: null,
      metadata: {}
    });
    // Already owned — must never be auto-claimed.
    store.upsertWorkItem({
      id: 'wi-owned',
      source: 'manual',
      title: 'In progress',
      status: 'running',
      priority: 'high',
      owner: 'codex',
      metadata: {}
    });
    // Done — must never be claimed.
    store.upsertWorkItem({
      id: 'wi-done',
      source: 'manual',
      title: 'Shipped',
      status: 'done',
      priority: 'high',
      owner: null,
      metadata: {}
    });
  } finally {
    store.close();
  }
}

async function run() {
  console.log('\n=== Testing work-items.js claim ===\n');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-items-claim-'));
  const dbPath = path.join(dir, 'state.db');

  try {
    await seed(dbPath);

    await test('claim picks the highest-priority unassigned open item and sets owner + kind', async () => {
      const result = runClaim(dbPath, ['--owner', 'alice', '--as', 'human']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.claimed, true);
      assert.strictEqual(payload.item.id, 'wi-unassigned-high', 'high-priority item claimed first');
      assert.strictEqual(payload.item.owner, 'alice');
      assert.strictEqual(payload.item.status, 'running', 'claim moves the card to running');
      assert.strictEqual(payload.item.metadata.assigneeKind, 'human');
    });

    await test('a second claim takes the next unassigned item, not an owned or done one', async () => {
      const result = runClaim(dbPath, ['--owner', 'bot-7', '--as', 'agent']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.claimed, true);
      assert.strictEqual(payload.item.id, 'wi-unassigned-low');
      assert.strictEqual(payload.item.metadata.assigneeKind, 'agent');
    });

    await test('claim reports nothing to do once the queue is drained', async () => {
      const result = runClaim(dbPath, ['--owner', 'alice']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.claimed, false);
      assert.strictEqual(payload.reason, 'no-unassigned-open-items');
    });

    await test('claim of a specific id works and rejects a missing id', async () => {
      const owned = runClaim(dbPath, ['wi-owned', '--owner', 'carol']);
      assert.strictEqual(owned.status, 0, owned.stderr);
      assert.strictEqual(JSON.parse(owned.stdout).item.owner, 'carol', 'explicit id can be re-claimed');

      const missing = runClaim(dbPath, ['nope-404', '--owner', 'carol']);
      assert.notStrictEqual(missing.status, 0, 'missing id should fail');
      assert.ok(/not found/i.test(missing.stderr), 'reports not found');
    });

    await test('claim requires --owner and validates --as', async () => {
      const noOwner = runClaim(dbPath, ['wi-done']);
      assert.notStrictEqual(noOwner.status, 0);
      assert.ok(/requires --owner/i.test(noOwner.stderr));

      const badKind = runClaim(dbPath, ['wi-owned', '--owner', 'x', '--as', 'robot']);
      assert.notStrictEqual(badKind.status, 0);
      assert.ok(/agent.*human/i.test(badKind.stderr));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
