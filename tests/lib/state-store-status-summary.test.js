'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createStateStore } = require('../../scripts/lib/state-store');

const ECC_SCRIPT = path.join(__dirname, '../../scripts/ecc.js');
const EXPECTED_COUNTS = { totalCount: 77, openCount: 42, blockedCount: 25, closedCount: 35 };

function populate(store) {
  const groups = [
    { statuses: ['done', 'CLOSED', 'resolved', 'MERGED', 'cancelled'], count: 7 },
    // JavaScript's existing case folding also recognizes the Kelvin sign as k.
    { statuses: ['blocked', 'NEEDS-REVIEW', 'failed', 'STALLED', 'bloc\u212aed'], count: 5 },
    { statuses: ['open', 'running', 'unfamiliar', ' blocked '], count: 3 },
  ];
  let index = 0;
  store._database.transaction(() => {
    for (const { statuses, count } of groups) {
      for (const status of statuses) {
        for (let repeat = 0; repeat < count; repeat += 1) {
          store.upsertWorkItem({
            id: `old-${index++}`, source: 'manual', title: 'Historical work', status,
            updatedAt: '2026-01-01T00:00:00.000Z',
            metadata: { summaryProbe: 'history', evidence: 'x'.repeat(4096) },
          });
        }
      }
    }
    for (let current = 0; current < 5; current += 1) {
      store.upsertWorkItem({
        id: `current-${current}`, source: 'manual', title: 'Current work', status: 'open',
        updatedAt: '2026-02-01T00:00:00.000Z',
        metadata: { summaryProbe: 'current', evidence: { value: current } },
      });
    }
  })();
}

function counts(workItems) {
  const { totalCount, openCount, blockedCount, closedCount } = workItems;
  return { totalCount, openCount, blockedCount, closedCount };
}

function observeMetadataReads(callback) {
  const original = JSON.parse;
  let parsed = 0;
  JSON.parse = function (text, ...args) {
    if (typeof text === 'string' && text.includes('"summaryProbe":')) parsed += 1;
    return original(text, ...args);
  };
  try { return { value: callback(), parsed }; }
  finally { JSON.parse = original; }
}

async function run() {
  let passed = 0;
  let failed = 0;
  async function test(name, callback) {
    try {
      await callback();
      console.log(`  PASS ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  FAIL ${name}\n    ${error.stack || error}`);
      failed += 1;
    }
  }

  await test('status only decodes metadata for the requested work-item window', async () => {
    const store = await createStateStore({ dbPath: ':memory:' });
    try {
      populate(store);
      for (const limit of [1, 5]) {
        const { value, parsed } = observeMetadataReads(() => store.getStatus({ workItemLimit: limit }));
        assert.deepStrictEqual(counts(value.workItems), EXPECTED_COUNTS);
        assert.strictEqual(value.readiness.blockedWorkItems, 25);
        assert.strictEqual(value.workItems.items.length, limit);
        assert.ok(value.workItems.items.every(item => item.metadata.summaryProbe === 'current'));
        assert.strictEqual(parsed, limit, 'historical metadata must not be decoded just to count statuses');
      }
    } finally { store.close(); }
  });

  await test('status preserves every status classification, full counts and fresh limited items', async () => {
    const store = await createStateStore({ dbPath: ':memory:' });
    try {
      populate(store);
      const limited = store.getStatus({ workItemLimit: 2 });
      const all = store.getStatus({ workItemLimit: 100 });
      assert.deepStrictEqual(counts(limited.workItems), EXPECTED_COUNTS);
      assert.deepStrictEqual(counts(all.workItems), EXPECTED_COUNTS);
      assert.strictEqual(all.workItems.items.length, 77);
      assert.deepStrictEqual(limited.workItems.items, all.workItems.items.slice(0, 2));
      limited.workItems.items[0].metadata.evidence.value = 'caller mutation';
      assert.strictEqual(store.getStatus({ workItemLimit: 1 }).workItems.items[0].metadata.evidence.value, 4);
    } finally { store.close(); }
  });

  await test('empty stores retain numeric zero counts and no attention items', async () => {
    const store = await createStateStore({ dbPath: ':memory:' });
    try {
      const status = store.getStatus();
      assert.deepStrictEqual(status.workItems, {
        totalCount: 0, openCount: 0, blockedCount: 0, closedCount: 0, items: [],
      });
      assert.strictEqual(status.readiness.attentionCount, 0);
      assert.strictEqual(status.readiness.status, 'ok');
    } finally { store.close(); }
  });

  await test('ecc status CLI keeps hidden blockers in readiness with a limited item list', async () => {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-status-summary-')));
    try {
      const dbPath = path.join(directory, 'state.db');
      const store = await createStateStore({ dbPath });
      try { populate(store); }
      finally { store.close(); }
      const result = spawnSync(process.execPath, [ECC_SCRIPT, 'status', '--db', dbPath,
        '--json', '--limit', '2', '--exit-code'], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, HOME: directory, USERPROFILE: directory,
          XDG_CONFIG_HOME: path.join(directory, '.config'),
          OPENCODE_CONFIG_DIR: path.join(directory, '.config/opencode') },
      });
      assert.strictEqual(result.status, 2, result.stderr);
      const status = JSON.parse(result.stdout);
      assert.deepStrictEqual(counts(status.workItems), EXPECTED_COUNTS);
      assert.strictEqual(status.workItems.items.length, 2);
      assert.ok(status.workItems.items.every(item => item.status === 'open'));
      assert.strictEqual(status.readiness.status, 'attention');
      assert.strictEqual(status.readiness.blockedWorkItems, 25);
      assert.strictEqual(status.readiness.attentionCount, 25);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
