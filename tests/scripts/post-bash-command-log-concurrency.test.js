'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { LOG_MAX_BYTES } = require('../../scripts/hooks/post-bash-command-log');
const worker = path.resolve(__dirname, '../lib/helpers/command-log-worker.js');
const signal = (root, name) => fs.writeFileSync(path.join(root, name), '', { mode: 0o600 });
async function waitFor(root, names) {
  const until = Date.now() + 10000;
  while (!names.some(name => fs.existsSync(path.join(root, name)))) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${names.join(' or ')}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function start(root, role, children) {
  const child = spawn(process.execPath, [worker, root, role], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, stop) => resolve({ code, stop, stderr }));
  });
  child.done.catch(() => {});
  children.push(child);
  return child;
}
async function finished(child) {
  const result = await child.done;
  assert.equal(result.code, 0, result.stderr);
}
async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-log-writers-'));
  const children = [];
  const file = path.join(root, '.claude', 'bash-commands.log');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, 'old-history\n', { mode: 0o600 });
  fs.truncateSync(file, LOG_MAX_BYTES);
  try { await run(root, file, children); }
  finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await child.done;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function archivePrefix(file) {
  const descriptor = fs.openSync(`${file}.1`, 'r');
  try {
    const bytes = Buffer.alloc(12);
    fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    return bytes.toString('utf8');
  } finally { fs.closeSync(descriptor); }
}

test('two writers cannot rotate a fresh log over the history another writer just archived', () => fixture(async (root, file, children) => {
  const owner = start(root, 'owner', children);
  await waitFor(root, ['owner-rotate-ready']);
  const contender = start(root, 'contender', children);
  await waitFor(root, ['contender-rotate-ready', 'contender-contended', 'contender-finished']);
  signal(root, 'owner-release');
  await finished(owner);
  signal(root, 'contender-release');
  await finished(contender);
  assert.equal(archivePrefix(file), 'old-history\n');
  const current = fs.readFileSync(file, 'utf8');
  const retained = current + fs.readFileSync(`${file}.1`, 'utf8');
  assert.match(retained, /echo owner/);
  assert.match(retained, /echo contender/);
  assert.equal(fs.existsSync(`${file}.lock`), false);
}));

test('a terminated rotating writer does not strand subsequent logging', () => fixture(async (root, file, children) => {
  const owner = start(root, 'owner', children);
  await waitFor(root, ['owner-rotate-ready']);
  owner.kill('SIGKILL');
  await owner.done;
  await finished(start(root, 'recovered', children));
  assert.equal(archivePrefix(file), 'old-history\n');
  assert.match(fs.readFileSync(file, 'utf8'), /echo recovered/);
  assert.equal(fs.existsSync(`${file}.lock`), false);
}));

test('contention stays bounded and records the command without racing a rotation', () => fixture(async (root, file, children) => {
  const owner = start(root, 'owner', children);
  await waitFor(root, ['owner-rotate-ready']);
  try { fs.utimesSync(`${file}.lock`, new Date(0), new Date(0)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await finished(start(root, 'busy', children));
  assert.equal(fs.existsSync(`${file}.1`), false, 'the waiting writer must not rotate outside the lock');
  signal(root, 'owner-release');
  await finished(owner);
  assert.equal(archivePrefix(file), 'old-history\n');
  assert.match(fs.readFileSync(`${file}.1`, 'utf8'), /echo busy/);
  assert.match(fs.readFileSync(file, 'utf8'), /echo owner/);
}));

test('release preserves a replacement owner lock instead of deleting it', () => fixture(async (root, file, children) => {
  await finished(start(root, 'replacement', children));
  assert.equal(fs.readFileSync(`${file}.lock`, 'utf8'), JSON.stringify({ pid: process.pid }));
  assert.match(fs.readFileSync(file, 'utf8'), /echo replacement/);
  assert.equal(archivePrefix(file), 'old-history\n');
}));

test('an exclusive-create collision never removes another file', () => fixture(async (root, file, children) => {
  const child = start(root, 'collision', children);
  await finished(child);
  const temporary = `${file}.lock.create-${child.pid}-${'00'.repeat(8)}`;
  assert.equal(fs.readFileSync(temporary, 'utf8'), 'foreign-create');
  assert.match(fs.readFileSync(file, 'utf8'), /echo collision/);
}));

test('an orphan recovery guard preserves its locks and records later commands without rotation', () => fixture(async (root, file, children) => {
  const owner = start(root, 'owner', children);
  await waitFor(root, ['owner-rotate-ready']);
  owner.kill('SIGKILL');
  await owner.done;
  const lockBytes = fs.readFileSync(`${file}.lock`, 'utf8');
  const guard = `${file}.lock.recover`;
  fs.writeFileSync(guard, JSON.stringify({ pid: owner.pid }), { flag: 'wx', mode: 0o600 });
  const guardBytes = fs.readFileSync(guard, 'utf8');
  await finished(start(root, 'orphan-guard', children));
  assert.equal(fs.existsSync(`${file}.1`), false);
  assert.equal(fs.readFileSync(`${file}.lock`, 'utf8'), lockBytes);
  assert.equal(fs.readFileSync(guard, 'utf8'), guardBytes);
  const retained = fs.readFileSync(file, 'utf8');
  assert.ok(retained.startsWith('old-history\n'));
  assert.match(retained, /echo orphan-guard/);
}));

test('release quarantine collisions preserve foreign bytes and the owned lock', () => fixture(async (root, file, children) => {
  const child = start(root, 'release-collision', children);
  await finished(child);
  const quarantine = `${file}.lock.release-${child.pid}-${'00'.repeat(8)}`;
  assert.equal(fs.readFileSync(quarantine, 'utf8'), 'foreign-release');
  assert.equal(fs.readFileSync(`${file}.lock`, 'utf8'), JSON.stringify({ pid: child.pid }));
  assert.match(fs.readFileSync(file, 'utf8'), /echo release-collision/);
}));

test('stale quarantine collisions preserve foreign bytes and defer recovery without losing the event', () => fixture(async (root, file, children) => {
  const owner = start(root, 'owner', children);
  await waitFor(root, ['owner-rotate-ready']);
  owner.kill('SIGKILL');
  await owner.done;
  const lockBytes = fs.readFileSync(`${file}.lock`, 'utf8');
  const child = start(root, 'stale-collision', children);
  await finished(child);
  const quarantine = `${file}.lock.stale-${child.pid}-${'00'.repeat(8)}`;
  assert.equal(fs.readFileSync(quarantine, 'utf8'), 'foreign-stale');
  assert.equal(fs.readFileSync(`${file}.lock`, 'utf8'), lockBytes);
  assert.equal(fs.existsSync(`${file}.1`), false);
  assert.match(fs.readFileSync(file, 'utf8'), /echo stale-collision/);
}));
