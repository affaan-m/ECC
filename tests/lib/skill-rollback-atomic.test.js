'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const versioning = require('../../scripts/lib/skill-evolution/versioning');
const health = require('../../scripts/lib/skill-evolution/health');

const repoRoot = path.resolve(__dirname, '../..');
const original = '# Original\n';
const unsnapshotted = '# Unsnapshotted work\nKeep these changes until rollback succeeds.\n';
let passed = 0;
let failed = 0;

function test(name, fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rollback-atomic-')));
  const skillDir = path.join(root, 'skills', 'demo');
  const live = path.join(skillDir, 'SKILL.md');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(live, original);
  try {
    fn({ root, skillDir, live });
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error.stack}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Fail the write of live content, whether it is direct or staged next to the
// destination. Snapshot publication in .versions is deliberately unaffected.
function failLivePublication(destination, phase, callback, alias = destination) {
  const saved = Object.fromEntries(
    ['openSync', 'closeSync', 'writeFileSync', 'fsyncSync'].map(name => [name, fs[name]])
  );
  const paths = new Map();
  const injected = Object.assign(new Error(`Injected live ${phase} failure`), { code: 'ENOSPC' });
  let reached = false;
  const isLiveWrite = file => {
    const name = typeof file === 'number' ? paths.get(file) : file;
    return typeof name === 'string' && (name === destination || name === alias
      || (path.dirname(name) === path.dirname(destination)
        && path.basename(name).startsWith(`.${path.basename(destination)}.`)
        && name.endsWith('.tmp')));
  };
  fs.openSync = (file, ...args) => {
    const descriptor = saved.openSync(file, ...args);
    paths.set(descriptor, file);
    return descriptor;
  };
  fs.closeSync = descriptor => {
    const result = saved.closeSync(descriptor);
    paths.delete(descriptor);
    return result;
  };
  fs.writeFileSync = (file, content, ...args) => {
    if (phase === 'partial-write' && isLiveWrite(file)) {
      saved.writeFileSync(file, Buffer.from(content).subarray(0, 4), ...args);
      reached = true;
      throw injected;
    }
    return saved.writeFileSync(file, content, ...args);
  };
  fs.fsyncSync = descriptor => {
    if (phase === 'sync' && isLiveWrite(descriptor)) {
      reached = true;
      throw injected;
    }
    return saved.fsyncSync(descriptor);
  };
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  } finally {
    Object.assign(fs, saved);
  }
  assert.equal(reached, true, 'the live publication fault must actually be reached');
  assert.ok(caught, 'publication must report its failure');
  assert.equal(paths.size, 0, 'publication must close its file descriptors');
  return { injected, caught };
}

function assertFailedPublication(fixture, phase) {
  const { root, skillDir, live } = fixture;
  versioning.createVersion(skillDir);
  fs.writeFileSync(live, unsnapshotted);
  const destination = fs.realpathSync(live);
  const log = versioning.getEvolutionLogPath(skillDir, 'amendments');
  const priorLog = fs.readFileSync(log);
  const { injected, caught } = failLivePublication(destination, phase, () => versioning.rollbackTo(skillDir, 1), live);

  assert.equal(fs.readFileSync(live, 'utf8'), unsnapshotted, 'failed rollback must preserve unsnapshotted bytes');
  assert.equal(caught, injected, 'report the original I/O failure after successful cleanup');
  assert.deepEqual(fs.readFileSync(log), priorLog);
  assert.deepEqual(fs.readdirSync(versioning.getVersionsDir(skillDir)).sort(), ['v1.md']);
  assert.equal(fs.readFileSync(path.join(versioning.getVersionsDir(skillDir), 'v1.md'), 'utf8'), original);
  assert.equal(fs.readdirSync(path.dirname(destination)).some(name => name.endsWith('.tmp')), false);
  const report = health.collectSkillHealth({ skillsRoot: path.join(root, 'skills'), homeDir: root });
  assert.equal(report.skills.find(skill => skill.skill_id === 'demo').current_version, 'v1');

  const retried = versioning.rollbackTo(skillDir, 1);
  assert.equal(retried.version, 2);
  assert.equal(fs.readFileSync(live, 'utf8'), original);
  assert.equal(fs.readFileSync(retried.path, 'utf8'), original);
  assert.equal(versioning.getEvolutionLog(skillDir, 'amendments').filter(row => row.event === 'rollback').length, 1);
}

test('a partially written rollback leaves unsnapshotted content and history intact', fixture => {
  assertFailedPublication(fixture, 'partial-write');
});

test('a failed sync leaves unsnapshotted content and history intact', fixture => {
  assertFailedPublication(fixture, 'sync');
});

if (process.platform !== 'win32') {
  test('a linked skill retains its target and alias across failed and retried rollback', fixture => {
    const target = path.join(fixture.root, 'source.md');
    fs.renameSync(fixture.live, target);
    const link = path.relative(fixture.skillDir, target);
    fs.symlinkSync(link, fixture.live);
    fs.chmodSync(target, 0o640);

    assertFailedPublication(fixture, 'partial-write');

    assert.equal(fs.lstatSync(fixture.live).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(fixture.live), link);
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    assert.equal(fs.statSync(target).mode & 0o777, 0o640);
  });
}

test('successful rollback keeps existing permissions under a restrictive umask', fixture => {
  const { skillDir, live } = fixture;
  versioning.createVersion(skillDir);
  fs.writeFileSync(live, unsnapshotted);
  fs.chmodSync(live, 0o640);
  const previous = process.umask(0o077);
  try {
    versioning.rollbackTo(live, 1);
  } finally {
    process.umask(previous);
  }
  assert.equal(fs.readFileSync(live, 'utf8'), original);
  if (process.platform !== 'win32') assert.equal(fs.statSync(live).mode & 0o777, 0o640);
});

test('a commands-only install supports rollback and reports its resulting version through the health CLI', fixture => {
  const { root, skillDir, live } = fixture;
  const installedRoot = path.join(root, '.claude');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: installedRoot };
  const run = args => spawnSync(process.execPath, args, {
    cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
  });
  const installed = run([
    path.join(repoRoot, 'scripts/install-apply.js'),
    '--target', 'claude-project', '--modules', 'commands-core', '--no-hooks', '--json',
  ]);
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);

  const restored = run(['-e', `
    const fs = require('node:fs');
    const path = require('node:path');
    const api = require(process.argv[1]);
    const skillDir = process.argv[2];
    api.createVersion(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Pending work');
    console.log(JSON.stringify(api.rollbackTo(skillDir, 1)));
  `, path.join(installedRoot, 'scripts/lib/skill-evolution'), skillDir]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(restored.stdout).version, 2);
  assert.equal(fs.readFileSync(live, 'utf8'), original);

  const result = run([
    path.join(installedRoot, 'scripts/skills-health.js'), '--json', '--home', root,
    '--skills-root', path.dirname(skillDir), '--learned-root', path.join(root, 'no-learned'),
    '--imported-root', path.join(root, 'no-imported'),
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).skills.find(skill => skill.skill_id === 'demo').current_version, 'v2');
});

console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
