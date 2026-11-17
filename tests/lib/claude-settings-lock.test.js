'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { acquireSettingsLock } = require('../../scripts/lib/install/claude-settings-lock');

async function owner(root, settingsPath) {
  const child = spawn(process.execPath, [
    path.join(__dirname, 'helpers', 'settings-lock-worker.js'), root, settingsPath,
  ], { env: { ...process.env, HOME: root, USERPROFILE: root, ECC_AGENT_DATA_HOME: path.join(root, '.claude') },
    stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  child.done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stderr }));
  });
  child.done.catch(() => {});
  const deadline = Date.now() + 10000;
  try {
    while (!fs.existsSync(path.join(root, 'held'))) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('Owner failed: ' + stderr);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return child;
  } catch (error) {
    child.kill('SIGKILL');
    await child.done;
    throw error;
  }
}
async function withOwner(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-settings-wait-'));
  const settingsPath = path.join(root, '.claude', 'session-aliases.json');
  let child;
  try {
    child = await owner(root, settingsPath);
    await callback(root, settingsPath, child);
  } finally {
    if (child) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await child.done;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const cases = [
  ['default contention is fail-fast; optional timeout is bounded and leaves owner intact', () => withOwner((_root, file) => {
    const before = fs.readFileSync(file + '.ecc.lock', 'utf8');
    assert.throws(() => acquireSettingsLock(file), /Another ECC process/);
    const start = performance.now();
    assert.throws(() => acquireSettingsLock(file, { timeoutMs: 50 }), /Another ECC process/);
    assert.ok(performance.now() - start >= 40, 'Waits for the configured deadline');
    assert.ok(performance.now() - start < 5000, 'Does not wait indefinitely');
    assert.strictEqual(fs.readFileSync(file + '.ecc.lock', 'utf8'), before);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['session-aliases.json.ecc.lock']);
  })],
  ['waiting succeeds when the real owner releases after the first contention', () => withOwner(async (root, file, child) => {
    const originalLink = fs.linkSync;
    let contended = false;
    fs.linkSync = function (source, target) {
      try { return originalLink.apply(this, arguments); }
      catch (error) {
        if (target === file + '.ecc.lock' && error.code === 'EEXIST') {
          contended = true;
          fs.writeFileSync(path.join(root, 'release'), '');
        }
        throw error;
      }
    };
    let release;
    try { release = acquireSettingsLock(file, { timeoutMs: 2000 }); }
    finally { fs.linkSync = originalLink; }
    assert.ok(contended);
    release();
    const result = await child.done;
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(!fs.existsSync(file + '.ecc.lock'));
  })],
  ['a killed owner is recovered by the next alias transaction', () => withOwner(async (root, file, child) => {
    child.kill('SIGKILL');
    await child.done;
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ECC_AGENT_DATA_HOME: process.env.ECC_AGENT_DATA_HOME };
    Object.assign(process.env, { HOME: root, USERPROFILE: root, ECC_AGENT_DATA_HOME: path.dirname(file) });
    try {
      const aliases = require('../../scripts/lib/session-aliases');
      assert.strictEqual(aliases.setAlias('recovered', '/session').success, true);
      assert.ok(aliases.loadAliases().aliases.recovered);
      assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['session-aliases.json']);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  })],
  ['non-contention errors propagate without retry', () => withOwner((_root, file) => {
    const originalLink = fs.linkSync;
    const expected = Object.assign(new Error('disk failure'), { code: 'EIO' });
    let attempts = 0;
    fs.linkSync = () => { attempts++; throw expected; };
    try {
      assert.throws(() => acquireSettingsLock(file, { timeoutMs: 2000 }), error => error === expected);
      assert.strictEqual(attempts, 1);
    } finally { fs.linkSync = originalLink; }
  })],
  ['recovery tolerates a lock disappearing between inspection and quarantine', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-lock-disappeared-'));
    const file = path.join(root, 'settings.json');
    const lock = file + '.ecc.lock';
    fs.writeFileSync(lock, '{}');
    fs.utimesSync(lock, new Date(0), new Date(0));
    const originalRename = fs.renameSync;
    let raced = false;
    fs.renameSync = function (source, target) {
      if (source === lock && target.includes('.stale-') && !raced) {
        raced = true;
        fs.unlinkSync(lock);
      }
      return originalRename.apply(this, arguments);
    };
    try {
      // Quarantine IO can consume a short deadline on native Windows runners.
      // Leave room for the next acquisition attempt after the injected ENOENT;
      // the separate contention case verifies the short bounded timeout.
      const release = acquireSettingsLock(file, { timeoutMs: 2000 });
      assert.ok(raced);
      release();
      assert.deepStrictEqual(fs.readdirSync(root), []);
    } finally {
      fs.renameSync = originalRename;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }],
  ['invalid timeout is rejected before touching disk', () => {
    for (const timeoutMs of [-1, NaN, Infinity, '1']) {
      assert.throws(() => acquireSettingsLock('unused', { timeoutMs }), /timeoutMs/);
    }
  }],
];
(async () => {
  let passed = 0;
  let failed = 0;
  for (const [name, run] of cases) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
  }
  console.log('Results: Passed: ' + passed + ', Failed: ' + failed);
  process.exitCode = failed ? 1 : 0;
})();
