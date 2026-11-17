'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { collectResources, buildInventory } = require('../../scripts/lib/coordination-inventory');

const supported = ['linux', 'darwin'].includes(process.platform);
const cli = path.resolve(__dirname, '../../scripts/coordination-inventory.js');
const task = (id, pid) => ({ id, pid, paths: [] });
const emptyExit = () => Object.assign(new Error('ps found no matching processes'), {
  status: 1, signal: null, stdout: '', stderr: '',
});

function exitedPid() {
  const child = spawnSync(process.execPath, ['-e', ''], { timeout: 5000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  return child.pid;
}

function report(tasks, resources) {
  return buildInventory({ version: 1, tasks }, { resources });
}

test('empty ps exit status is a successful empty observation on both supported platforms', () => {
  for (const platform of ['linux', 'darwin']) {
    const tasks = [task('finished', 12), task('no-pid', null)];
    const resources = collectResources(tasks, {
      platform, totalmem: () => 1024, freemem: () => 512,
      execFileSync: () => { throw emptyExit(); },
    });
    assert.equal(resources.processStatus, 'ok');
    assert.deepEqual(resources.processes, []);
    assert.equal(resources.memory.freeBytes, 512);
    assert.deepEqual(report(tasks, resources).tasks.map(t => t.process.state), ['not-observed', 'unknown']);
  }
});

test('diagnostics, partial output, signals, launch failures and incomplete errors stay unavailable', () => {
  const failures = [
    { status: 2 }, { status: null }, { status: undefined },
    { stdout: '12 1 32 01:30 S\n' }, { stdout: ' ' }, { stdout: undefined },
    { stderr: 'permission denied' }, { stderr: '\n' }, { stderr: undefined },
    { signal: 'SIGTERM' }, { code: 'ETIMEDOUT' }, { code: 'ENOBUFS' }, { code: 'ENOENT' },
  ].map(overrides => Object.assign(emptyExit(), overrides));
  failures.push(null, new Error('no status information'));
  for (const error of failures) {
    const tasks = [task('worker', 12)];
    const resources = collectResources(tasks, { platform: 'linux', execFileSync: () => { throw error; } });
    assert.equal(resources.processStatus, 'unavailable');
    assert.deepEqual(resources.processes, []);
    assert.equal(report(tasks, resources).tasks[0].process.state, 'unknown');
  }
});

test('a real ps probe observes no matches after child processes have exited', { skip: !supported }, () => {
  const first = exitedPid();
  const second = exitedPid();
  const tasks = [task('first', first), task('second', second), task('duplicate-pid', first), task('unassigned', null)];
  const before = JSON.stringify(tasks);
  const resources = collectResources(tasks);
  assert.equal(resources.processStatus, 'ok');
  assert.deepEqual(resources.processes, []);
  assert.deepEqual(report(tasks, resources).tasks.map(t => t.process.state),
    ['not-observed', 'not-observed', 'not-observed', 'unknown']);
  assert.equal(JSON.stringify(tasks), before);
});

test('a real mixed process selection retains matching metadata and missing-PID states', { skip: !supported }, () => {
  const tasks = [task('current', process.pid), task('finished', exitedPid()), task('unassigned', null)];
  const resources = collectResources(tasks);
  assert.equal(resources.processStatus, 'ok');
  assert.equal(resources.processes.length, 1);
  assert.equal(resources.processes[0].pid, process.pid);
  assert.ok(resources.processes[0].rssBytes > 0);
  assert.deepEqual(report(tasks, resources).tasks.map(t => t.process.state), ['observed', 'not-observed', 'unknown']);
});

test('the live CLI reports an empty observation and leaves its manifest unchanged', { skip: !supported }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-empty-processes-'));
  try {
    const file = path.join(dir, 'manifest.json');
    const input = JSON.stringify({ version: 1, tasks: [task('finished', exitedPid()), task('unassigned', null)] });
    fs.writeFileSync(file, input);
    const result = spawnSync(process.execPath, [cli, '--manifest', file, '--live'], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.resources.processStatus, 'ok');
    assert.deepEqual(output.resources.processes, []);
    assert.deepEqual(output.tasks.map(t => t.process.state), ['not-observed', 'unknown']);
    assert.equal(fs.readFileSync(file, 'utf8'), input);
    assert.deepEqual(fs.readdirSync(dir), ['manifest.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the live CLI preserves unavailable observations when ps cannot be launched', { skip: !supported }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-missing-ps-'));
  try {
    const file = path.join(dir, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, tasks: [task('current', process.pid)] }));
    const result = spawnSync(process.execPath, [cli, '--manifest', file, '--live'], {
      encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, PATH: dir },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.resources.processStatus, 'unavailable');
    assert.equal(output.tasks[0].process.state, 'unknown');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
