'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const observer = require('../../scripts/lib/copilot-observer');
const { configRoot, projectDirectory } = require('../../scripts/lib/copilot-sessions');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-worker-'));
const workspace = fs.realpathSync(root);
const env = { ...process.env, COPILOT_HOME: path.join(root, 'private') };
const projectId = hash(workspace);
let passed = 0;
function seed() {
  const directory = projectDirectory(workspace, env, true);
  fs.writeFileSync(path.join(directory, 'observations.jsonl'), '');
  const mapping = path.join(configRoot(env), 'ecc', 'learning-mappings'); fs.mkdirSync(mapping, { recursive: true });
  fs.writeFileSync(path.join(mapping, `${projectId}.json`), JSON.stringify({ schema: 'ecc.copilot.learning-mapping.v1',
    observationProjectId: projectId, learningProjectId: '0123456789ab', identitySource: 'canonical-detect-project' }));
}
async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Worker fixture did not reach its bounded expected state.');
}
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
async function main() {
  seed();
  await test('explicit worker starts, duplicate start refuses and cooperative stop never signals a PID', async () => {
    const started = observer.start(workspace, { backend: 'metadata-sequences', intervalMs: 1000, durationMs: 10000, maxRuns: 20 }, env);
    assert.equal(started.status, 'starting');
    await until(() => observer.status(workspace, env).status === 'registered');
    assert.throws(() => observer.start(workspace, { backend: 'metadata-sequences' }, env), /EEXIST/);
    const original = process.kill;
    try {
      process.kill = () => { throw new Error('stop must not send a signal'); };
      assert.equal(observer.stop(workspace, env).signalSent, false);
    } finally { process.kill = original; }
    await until(() => observer.status(workspace, env).status === 'stopped');
    assert.equal(observer.readState(workspace, env).candidates.length, 0);
  });
  await test('worker exits at maximum run count without an immortal background process', async () => {
    const entry = path.resolve(__dirname, '../../scripts/copilot-observer.js');
    const result = spawnSync(process.execPath, [entry, 'start', '--backend', 'metadata-sequences', '--interval-ms', '250', '--duration-ms', '5000', '--max-runs', '1'], {
      cwd: workspace, env, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).status, 'starting');
    await until(() => observer.status(workspace, env).status === 'stopped');
  });
  await test('worker lifetime expires independently of the maximum run count', async () => {
    observer.start(workspace, { backend: 'metadata-sequences', intervalMs: 5000, durationMs: 1000, maxRuns: 100 }, env);
    await until(() => observer.status(workspace, env).status === 'stopped');
    const result = observer.status(workspace, env).lastResult;
    assert.equal(result.status, 'expired'); assert.equal(result.runs, 1);
  });
  await test('limits and unsupported backends reject before starting a process', () => {
    for (const options of [{ backend: 'arbitrary-program' }, { backend: 'metadata-sequences', durationMs: 999 },
      { backend: 'metadata-sequences', maxRuns: 1000 }, { backend: 'metadata-sequences', intervalMs: 0 }]) {
      assert.throws(() => observer.start(workspace, options, env));
    }
    assert.equal(observer.status(workspace, env).status, 'stopped');
  });
  await test('failed worker analysis leaves an explicit failed result, not an apparent success', async () => {
    const file = path.join(projectDirectory(workspace, env), 'observations.jsonl');
    fs.writeFileSync(file, '{broken');
    observer.start(workspace, { backend: 'metadata-sequences', intervalMs: 250, durationMs: 1000, maxRuns: 1 }, env);
    await until(() => observer.status(workspace, env).status === 'stopped');
    assert.equal(observer.status(workspace, env).lastResult.status, 'failed');
    assert.equal(observer.status(workspace, env).lastResult.runs, 0);
    fs.writeFileSync(file, '');
  });
  await test('crash recovery requires matching token and a confirmed dead PID, preserves candidates', () => {
    const files = path.join(path.dirname(observer.stateFile(workspace, env)), 'worker.lock'); fs.mkdirSync(files);
    const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
    const token = 'a'.repeat(48);
    const owner = { schema: 'ecc.copilot.observer-worker.v1', token, pid: dead.pid, projectId,
      backend: 'metadata-sequences', intervalMs: 1000, expiresAt: Date.now() + 1000, maxRuns: 1 };
    const file = path.join(files, 'owner.json'); fs.writeFileSync(file, JSON.stringify(owner));
    assert.equal(observer.status(workspace, env).status, 'stale');
    assert.throws(() => observer.recover(workspace, 'b'.repeat(48), env));
    fs.writeFileSync(file, JSON.stringify({ ...owner, pid: process.pid }));
    assert.throws(() => observer.recover(workspace, token, env));
    fs.writeFileSync(file, JSON.stringify(owner));
    const entry = path.resolve(__dirname, '../../scripts/copilot-observer.js');
    const recovered = spawnSync(process.execPath, [entry, 'recover', '--token', token], {
      cwd: workspace, env, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(recovered.status, 0, recovered.stderr); assert.equal(JSON.parse(recovered.stdout).status, 'recovered');
    assert.ok(observer.readState(workspace, env));
  });
  await test('linked worker ownership is rejected and never signalled', () => {
    const dir = path.dirname(observer.stateFile(workspace, env));
    const target = path.join(root, 'outside'); fs.mkdirSync(target);
    const linked = path.join(dir, 'worker.lock'); fs.symlinkSync(target, linked);
    assert.throws(() => observer.status(workspace, env), /Unsafe/);
    assert.throws(() => observer.stop(workspace, env), /Unsafe/);
    fs.unlinkSync(linked); assert.ok(fs.existsSync(target));
  });
  console.log(`Passed: ${passed}, Failed: 0`);
}
main().then(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => {
  try { observer.stop(workspace, env); } catch { /* Preserve primary failure. */ }
  console.error(error); process.exitCode = 1;
});
