'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { acquireSettingsLock } = require('../../scripts/lib/install/claude-settings-lock');
const { recordSkillExecution, readSkillExecutionRecords } = require('../../scripts/lib/skill-evolution/tracker');

const payload = skillId => ({
  skill_id: skillId, skill_version: 'v1', task_description: 'Concurrent run',
  outcome: 'success', recorded_at: '2026-03-15T12:00:00.000Z',
});

async function waitFor(root, names) {
  const deadline = Date.now() + 10000;
  while (!names.some(name => fs.existsSync(path.join(root, name)))) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${names.join(' or ')}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function startWorker(root, role) {
  const child = spawn(process.execPath, [path.join(__dirname, 'helpers', 'skill-runs-worker.js'), root, role], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stderr }));
  });
  child.done.catch(() => {});
  return child;
}

const cases = [
  ['concurrent retention preserves the latest run after another writer has taken a snapshot', async (root, file, children) => {
    recordSkillExecution(payload('seed-0'), { runsFilePath: file, maxRecords: 2 });
    recordSkillExecution(payload('seed-1'), { runsFilePath: file, maxRecords: 2 });
    const owner = startWorker(root, 'owner');
    children.push(owner);
    await waitFor(root, ['snapshot-ready']);
    const contender = startWorker(root, 'contender');
    children.push(contender);
    await waitFor(root, ['contender-finished', 'contended']);
    fs.writeFileSync(path.join(root, 'release'), '');
    for (const child of children) {
      const result = await child.done;
      assert.strictEqual(result.code, 0, result.stderr);
    }
    assert.deepStrictEqual(readSkillExecutionRecords({ runsFilePath: file }).map(row => row.skill_id), ['owner', 'contender']);
    assert.ok(!fs.existsSync(`${file}.ecc.lock`), 'both writers release the lock');
  }],
  ['a lock timeout preserves the existing sink and never appends outside the lock', (_root, file) => {
    recordSkillExecution(payload('seed'), { runsFilePath: file });
    const before = fs.readFileSync(file, 'utf8');
    const release = acquireSettingsLock(file);
    try {
      assert.throws(() => recordSkillExecution(payload('busy'), { runsFilePath: file, lockTimeoutMs: 20 }), /Another ECC process/);
      assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    } finally {
      release();
    }
  }],
  ['an append error releases the lock and a later write succeeds', (_root, file) => {
    const append = fs.appendFileSync;
    const expected = Object.assign(new Error('Injected append failure'), { code: 'EIO' });
    fs.appendFileSync = (target, ...args) => {
      if (target === file) throw expected;
      return append(target, ...args);
    };
    try {
      assert.throws(() => recordSkillExecution(payload('failed'), { runsFilePath: file }), error => error === expected);
    } finally {
      fs.appendFileSync = append;
    }
    assert.ok(!fs.existsSync(`${file}.ecc.lock`));
    recordSkillExecution(payload('retry'), { runsFilePath: file });
    assert.deepStrictEqual(readSkillExecutionRecords({ runsFilePath: file }).map(row => row.skill_id), ['retry']);
  }],
  ['a terminated writer does not permanently block subsequent telemetry', async (root, file, children) => {
    const owner = startWorker(root, 'owner');
    children.push(owner);
    await waitFor(root, ['snapshot-ready']);
    owner.kill('SIGKILL');
    await owner.done;
    recordSkillExecution(payload('recovered'), { runsFilePath: file, maxRecords: 2 });
    assert.deepStrictEqual(readSkillExecutionRecords({ runsFilePath: file }).map(row => row.skill_id), ['owner', 'recovered']);
    assert.ok(!fs.existsSync(`${file}.ecc.lock`));
  }],
];

(async () => {
  let passed = 0;
  let failed = 0;
  for (const [name, run] of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-runs-'));
    const children = [];
    try {
      await run(root, path.join(root, 'runs.jsonl'), children);
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed++;
      console.error(`  ✗ ${name}: ${error.message}`);
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await child.done;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
