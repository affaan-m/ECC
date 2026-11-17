'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const versioning = require('../../scripts/lib/skill-evolution/versioning');
const health = require('../../scripts/lib/skill-evolution/health');

let passed = 0;
let failed = 0;

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-evolution-storage-'));
  const skillDir = path.join(root, 'skills', 'demo');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Original\n');
  return { root, skillDir, versionsDir: versioning.getVersionsDir(skillDir) };
}

function test(name, fn) {
  const fixture = createFixture();
  try {
    fn(fixture);
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}: ${error.message}`);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

test('snapshot creation preserves occupied directories and links plus earlier snapshots', fixture => {
  const { root, skillDir, versionsDir } = fixture;
  versioning.createVersion(skillDir);
  fs.mkdirSync(path.join(versionsDir, 'v2.md'));
  fs.writeFileSync(path.join(versionsDir, 'v2.md', 'keep.txt'), 'preserve');
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(root, 'missing'), path.join(versionsDir, 'v3.md'));
  }
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Updated\n');
  const snapshot = versioning.createVersion(skillDir);
  assert.equal(snapshot.version, process.platform === 'win32' ? 3 : 4);
  assert.equal(fs.readFileSync(snapshot.path, 'utf8'), '# Updated\n');
  assert.equal(fs.readFileSync(path.join(versionsDir, 'v1.md'), 'utf8'), '# Original\n');
  assert.equal(fs.readFileSync(path.join(versionsDir, 'v2.md', 'keep.txt'), 'utf8'), 'preserve');
  assert.equal(versioning.getEvolutionLog(skillDir, 'amendments').at(-1).version, snapshot.version);
  if (process.platform !== 'win32') {
    assert.ok(fs.lstatSync(path.join(versionsDir, 'v3.md')).isSymbolicLink());
    fs.symlinkSync(path.join(versionsDir, 'v1.md'), path.join(versionsDir, 'v5.md'));
    assert.deepEqual(versioning.listVersions(skillDir).map(entry => entry.version), [1, 4, 5]);
    assert.equal(versioning.getCurrentVersion(skillDir), 5);
  }
});

test('health skips malformed amendment rows while retaining a valid pending proposal', fixture => {
  const { root, skillDir } = fixture;
  versioning.ensureSkillVersioning(skillDir);
  fs.writeFileSync(versioning.getEvolutionLogPath(skillDir, 'amendments'),
    'null\n[]\n42\n{bad}\n{"event":"proposal","status":"pending"}\n');
  const report = health.collectSkillHealth({
    skillsRoot: path.join(root, 'skills'), homeDir: root, now: '2026-03-15T12:00:00.000Z',
  });
  assert.equal(report.skills.find(skill => skill.skill_id === 'demo').pending_amendments, 1);
});

test('snapshot allocation ignores invalid numeric names and preserves their contents', fixture => {
  const { skillDir, versionsDir } = fixture;
  fs.mkdirSync(versionsDir);
  const names = ['v0.md', 'v9007199254740992.md', `v${'9'.repeat(80)}.md`];
  for (const name of names) fs.writeFileSync(path.join(versionsDir, name), 'preserve');
  assert.deepEqual(versioning.listVersions(skillDir), []);
  const snapshot = versioning.createVersion(skillDir);
  assert.equal(snapshot.version, 1);
  assert.equal(fs.readFileSync(snapshot.path, 'utf8'), '# Original\n');
  for (const name of names) assert.equal(fs.readFileSync(path.join(versionsDir, name), 'utf8'), 'preserve');
});

test('exhausted snapshot numbering refuses creation before initializing evolution logs', fixture => {
  const { skillDir, versionsDir } = fixture;
  fs.mkdirSync(versionsDir);
  const last = path.join(versionsDir, `v${Number.MAX_SAFE_INTEGER}.md`);
  fs.writeFileSync(last, 'preserve');
  assert.throws(() => versioning.createVersion(skillDir), /snapshot version range is exhausted/);
  assert.deepEqual(fs.readdirSync(versionsDir).sort(), [`v${Number.MAX_SAFE_INTEGER}.md`]);
  assert.equal(fs.readFileSync(last, 'utf8'), 'preserve');
  assert.equal(fs.existsSync(versioning.getEvolutionDir(skillDir)), false);
});

test('an occupied final safe snapshot path refuses creation while preserving the directory', fixture => {
  const { skillDir, versionsDir } = fixture;
  fs.mkdirSync(versionsDir);
  fs.writeFileSync(path.join(versionsDir, `v${Number.MAX_SAFE_INTEGER - 1}.md`), 'preserve');
  const occupied = path.join(versionsDir, `v${Number.MAX_SAFE_INTEGER}.md`);
  fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied, 'keep.txt'), 'preserve');
  assert.throws(() => versioning.createVersion(skillDir), /snapshot version range is exhausted/);
  assert.equal(fs.readdirSync(versionsDir).length, 2);
  assert.equal(fs.readFileSync(path.join(occupied, 'keep.txt'), 'utf8'), 'preserve');
  assert.equal(fs.existsSync(versioning.getEvolutionDir(skillDir)), false);
});

test('exhausted rollback preserves unsnapshotted content, snapshot files and evolution state', fixture => {
  const { skillDir, versionsDir } = fixture;
  fs.mkdirSync(versionsDir);
  const previous = path.join(versionsDir, 'v1.md');
  const last = path.join(versionsDir, `v${Number.MAX_SAFE_INTEGER}.md`);
  fs.writeFileSync(previous, '# Previous\n');
  fs.writeFileSync(last, '# Latest snapshot\n');
  const assertPreserved = () => {
    assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Original\n');
    assert.equal(fs.readFileSync(previous, 'utf8'), '# Previous\n');
    assert.equal(fs.readFileSync(last, 'utf8'), '# Latest snapshot\n');
    assert.equal(fs.readdirSync(versionsDir).length, 2);
  };
  assert.throws(() => versioning.rollbackTo(skillDir, 1), /snapshot version range is exhausted/);
  assertPreserved();
  assert.equal(fs.existsSync(versioning.getEvolutionDir(skillDir)), false);
  versioning.ensureSkillVersioning(skillDir);
  const logs = versioning.EVOLUTION_LOG_TYPES.map(type => versioning.getEvolutionLogPath(skillDir, type));
  for (const file of logs) fs.writeFileSync(file, '{"event":"preserve"}\n');
  assert.throws(() => versioning.rollbackTo(skillDir, 1), /snapshot version range is exhausted/);
  assertPreserved();
  for (const file of logs) assert.equal(fs.readFileSync(file, 'utf8'), '{"event":"preserve"}\n');
});

test('unsafe rollback targets preserve the live skill and excluded snapshots', fixture => {
  const { skillDir, versionsDir } = fixture;
  fs.mkdirSync(versionsDir);
  const invalid = path.join(versionsDir, 'v9007199254740992.md');
  fs.writeFileSync(invalid, '# Excluded snapshot\n');
  for (const target of [9007199254740992, '9007199254740992']) {
    assert.throws(() => versioning.rollbackTo(skillDir, target), /Invalid target version/);
    assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Original\n');
    assert.equal(fs.readFileSync(invalid, 'utf8'), '# Excluded snapshot\n');
    assert.equal(fs.readdirSync(versionsDir).length, 1);
    assert.equal(fs.existsSync(versioning.getEvolutionDir(skillDir)), false);
  }
});

test('rollback initialization failure preserves unsnapshotted live bytes and the target', fixture => {
  const { skillDir, versionsDir } = fixture;
  fs.mkdirSync(versionsDir);
  const target = path.join(versionsDir, 'v1.md');
  fs.writeFileSync(target, '# Saved target\n');
  fs.writeFileSync(versioning.getEvolutionDir(skillDir), 'owned blocker');
  assert.throws(() => versioning.rollbackTo(skillDir, 1), error => Boolean(error.code));
  assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Original\n');
  assert.equal(fs.readFileSync(target, 'utf8'), '# Saved target\n');
  assert.deepEqual(fs.readdirSync(versionsDir).sort(), ['v1.md']);
  assert.equal(fs.readFileSync(versioning.getEvolutionDir(skillDir), 'utf8'), 'owned blocker');
});

test('rollback exclusive publication failure preserves live bytes and permits a later retry', fixture => {
  const { skillDir, versionsDir } = fixture;
  versioning.createVersion(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Unsnapshotted work\n');
  const amendmentPath = versioning.getEvolutionLogPath(skillDir, 'amendments');
  const priorLog = fs.readFileSync(amendmentPath, 'utf8');
  const writeFileSync = fs.writeFileSync;
  const injectedError = Object.assign(new Error('Injected snapshot publication failure'), { code: 'EIO' });
  fs.writeFileSync = (file, ...args) => {
    if (typeof file === 'number' && args[0] === '# Original\n') throw injectedError;
    return writeFileSync(file, ...args);
  };
  try {
    assert.throws(() => versioning.rollbackTo(skillDir, 1), error => error === injectedError);
  } finally {
    fs.writeFileSync = writeFileSync;
  }
  assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Unsnapshotted work\n');
  assert.equal(fs.readFileSync(path.join(versionsDir, 'v1.md'), 'utf8'), '# Original\n');
  assert.deepEqual(fs.readdirSync(versionsDir).sort(), ['v1.md']);
  assert.equal(fs.readFileSync(amendmentPath, 'utf8'), priorLog);
  const restored = versioning.rollbackTo(skillDir, 1);
  assert.equal(restored.version, 2);
  assert.equal(fs.readFileSync(restored.path, 'utf8'), '# Original\n');
  assert.equal(fs.readFileSync(restored.path, 'utf8'), fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'));
  assert.equal(versioning.getEvolutionLog(skillDir, 'amendments').at(-1).event, 'rollback');
});

test('failed live rollback write preserves version and applied history, then retries without a duplicate', fixture => {
  const { root, skillDir, versionsDir } = fixture;
  versioning.createVersion(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Unsnapshotted work\n');
  const logPath = versioning.getEvolutionLogPath(skillDir, 'amendments');
  const priorLog = fs.readFileSync(logPath, 'utf8');
  const writeFileSync = fs.writeFileSync;
  const injectedError = Object.assign(new Error('Injected live write failure'), { code: 'EACCES' });
  fs.writeFileSync = (file, ...args) => {
    if (file === path.join(skillDir, 'SKILL.md')) throw injectedError;
    return writeFileSync(file, ...args);
  };
  try {
    assert.throws(() => versioning.rollbackTo(skillDir, 1), error => error === injectedError);
  } finally {
    fs.writeFileSync = writeFileSync;
  }
  assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Unsnapshotted work\n');
  assert.deepEqual(fs.readdirSync(versionsDir).sort(), ['v1.md']);
  assert.equal(versioning.getCurrentVersion(skillDir), 1);
  assert.equal(fs.readFileSync(logPath, 'utf8'), priorLog);
  const report = health.collectSkillHealth({ skillsRoot: path.join(root, 'skills'), homeDir: root });
  assert.equal(report.skills.find(skill => skill.skill_id === 'demo').current_version, 'v1');
  const restored = versioning.rollbackTo(skillDir, 1);
  assert.equal(restored.version, 2);
  assert.equal(fs.readFileSync(restored.path, 'utf8'), fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'));
  assert.equal(versioning.getEvolutionLog(skillDir, 'amendments').filter(row => row.event === 'rollback').length, 1);
});

test('failed rollback preserves a foreign snapshot replacement and both error details', fixture => {
  const { skillDir, versionsDir } = fixture;
  versioning.createVersion(skillDir);
  const live = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(live, '# Unsnapshotted work\n');
  const target = path.join(versionsDir, 'v2.md');
  const writeFileSync = fs.writeFileSync;
  const primary = Object.assign(new Error('Injected live refusal'), { code: 'EACCES' });
  fs.writeFileSync = (file, ...args) => {
    if (file === live) {
      fs.renameSync(target, path.join(versionsDir, 'owned-attempt.saved'));
      writeFileSync(target, '# Foreign snapshot\n');
      throw primary;
    }
    return writeFileSync(file, ...args);
  };
  try {
    assert.throws(() => versioning.rollbackTo(skillDir, 1), error =>
      error.primaryError === primary && /changed ownership/.test(error.recoveryError.message) && /recovery is pending/.test(error.message));
  } finally {
    fs.writeFileSync = writeFileSync;
  }
  assert.equal(fs.readFileSync(live, 'utf8'), '# Unsnapshotted work\n');
  assert.equal(fs.readFileSync(target, 'utf8'), '# Foreign snapshot\n');
  assert.equal(versioning.getEvolutionLog(skillDir, 'amendments').filter(row => row.event === 'rollback').length, 0);
});

test('descriptor metadata and final-link failures never expose an empty or incomplete version', fixture => {
  const { skillDir, versionsDir } = fixture;
  versioning.createVersion(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Unsnapshotted work\n');
  const logPath = versioning.getEvolutionLogPath(skillDir, 'amendments');
  const priorLog = fs.readFileSync(logPath, 'utf8');
  for (const operation of ['fstatSync', 'linkSync']) {
    const original = fs[operation];
    const openSync = fs.openSync;
    let publicationDescriptor;
    let reachedPublication = false;
    fs.openSync = (file, ...args) => {
      const descriptor = openSync(file, ...args);
      const directory = path.basename(path.dirname(file));
      if (directory.startsWith('.snapshot-') && !directory.startsWith('.snapshot-storage-')) publicationDescriptor = descriptor;
      return descriptor;
    };
    const injectedError = Object.assign(new Error(`Injected ${operation} failure`), { code: 'EIO' });
    fs[operation] = (...args) => {
      if ((operation === 'fstatSync' && args[0] === publicationDescriptor)
        || (operation === 'linkSync' && args[1] === path.join(versionsDir, 'v2.md'))) {
        reachedPublication = true;
        throw injectedError;
      }
      return original(...args);
    };
    try {
      assert.throws(() => versioning.rollbackTo(skillDir, 1), error => error === injectedError || (error.primaryError === injectedError && /recovery is pending/.test(error.message)));
    } finally {
      fs[operation] = original;
      fs.openSync = openSync;
    }
    assert.equal(reachedPublication, true, `${operation} must fail publication after the storage probe succeeds`);
    assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Unsnapshotted work\n');
    assert.equal(fs.existsSync(path.join(versionsDir, 'v2.md')), false);
    assert.deepEqual(versioning.listVersions(skillDir).map(row => row.version), [1]);
    assert.equal(versioning.getCurrentVersion(skillDir), 1);
    assert.equal(fs.readFileSync(logPath, 'utf8'), priorLog);
  }
  const restored = versioning.rollbackTo(skillDir, 1);
  assert.equal(restored.version, 2);
  assert.equal(fs.readFileSync(restored.path, 'utf8'), fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'));
});

test('exclusive snapshot publication preserves a path occupied after allocation', fixture => {
  const { skillDir, versionsDir } = fixture;
  versioning.createVersion(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Unsnapshotted work\n');
  const target = path.join(versionsDir, 'v2.md');
  const linkSync = fs.linkSync;
  fs.linkSync = (source, destination) => {
    if (destination === target) fs.writeFileSync(target, '# Foreign snapshot\n', { flag: 'wx' });
    return linkSync(source, destination);
  };
  try {
    assert.throws(() => versioning.rollbackTo(skillDir, 1), error => error.code === 'EEXIST');
  } finally {
    fs.linkSync = linkSync;
  }
  assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Unsnapshotted work\n');
  assert.equal(fs.readFileSync(target, 'utf8'), '# Foreign snapshot\n');
  assert.deepEqual(fs.readdirSync(versionsDir).sort(), ['v1.md', 'v2.md']);
  assert.equal(versioning.getEvolutionLog(skillDir, 'amendments').filter(row => row.event === 'rollback').length, 0);
});

test('snapshot staging cleanup preserves foreign entries and permits a clean later retry', fixture => {
  const { skillDir, versionsDir } = fixture;
  versioning.createVersion(skillDir);
  const live = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(live, '# Unsnapshotted work\n');
  const linkSync = fs.linkSync;
  let foreignPath;
  fs.linkSync = (source, destination) => {
    if (destination === path.join(versionsDir, 'v2.md')) {
      foreignPath = path.join(path.dirname(source), 'foreign-owned.txt');
      fs.writeFileSync(foreignPath, 'foreign work');
    }
    return linkSync(source, destination);
  };
  try {
    assert.throws(() => versioning.rollbackTo(skillDir, 1), error => /recovery is pending/.test(error.message));
  } finally {
    fs.linkSync = linkSync;
  }
  assert.ok(foreignPath, 'foreign entry must be injected into publication staging');
  assert.equal(fs.readFileSync(foreignPath, 'utf8'), 'foreign work');
  assert.equal(fs.readFileSync(live, 'utf8'), '# Unsnapshotted work\n');
  assert.equal(fs.existsSync(path.join(versionsDir, 'v2.md')), false);
  assert.equal(versioning.getCurrentVersion(skillDir), 1);
  assert.equal(versioning.getEvolutionLog(skillDir, 'amendments').filter(row => row.event === 'rollback').length, 0);
  const restored = versioning.rollbackTo(skillDir, 1);
  assert.equal(restored.version, 2);
  assert.equal(fs.readFileSync(restored.path, 'utf8'), fs.readFileSync(live, 'utf8'));
  assert.equal(fs.readFileSync(foreignPath, 'utf8'), 'foreign work');
});

for (const phase of ['storage', 'publication']) {
for (const foreign of [false, true]) {
test(`unverified ${phase} staging directory identity preserves ${foreign ? 'foreign contents' : 'empty directory'} with a pending diagnostic`, fixture => {
  const { skillDir, versionsDir } = fixture;
  versioning.createVersion(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Unsnapshotted work\n');
  const logPath = versioning.getEvolutionLogPath(skillDir, 'amendments');
  const priorLog = fs.readFileSync(logPath, 'utf8');
  const lstatSync = fs.lstatSync;
  let stagingDir;
  const primary = Object.assign(new Error('Injected staging identity failure'), { code: 'EIO' });
  fs.lstatSync = (file, ...args) => {
    const name = path.basename(file);
    if (phase === 'storage' ? name.startsWith('.snapshot-storage-') : name.startsWith('.snapshot-') && !name.startsWith('.snapshot-storage-')) {
      stagingDir = file;
      if (foreign) fs.writeFileSync(path.join(file, 'foreign-owned.txt'), 'preserve');
      throw primary;
    }
    return lstatSync(file, ...args);
  };
  try {
    assert.throws(() => versioning.rollbackTo(skillDir, 1), error =>
      error.primaryError === primary && /identity could not be verified/.test(error.message) && /recovery is pending/.test(error.message));
  } finally {
    fs.lstatSync = lstatSync;
  }
  if (foreign) assert.equal(fs.readFileSync(path.join(stagingDir, 'foreign-owned.txt'), 'utf8'), 'preserve');
  else assert.deepEqual(fs.readdirSync(stagingDir), []);
  assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Unsnapshotted work\n');
  assert.equal(fs.existsSync(path.join(versionsDir, 'v2.md')), false);
  assert.equal(versioning.getCurrentVersion(skillDir), 1);
  assert.equal(fs.readFileSync(logPath, 'utf8'), priorLog);
  const restored = versioning.rollbackTo(skillDir, 1);
  assert.equal(restored.version, 2);
  if (foreign) assert.equal(fs.readFileSync(path.join(stagingDir, 'foreign-owned.txt'), 'utf8'), 'preserve');
  else assert.deepEqual(fs.readdirSync(stagingDir), []);
});

}
}

for (const rollback of [false, true]) {
  test(`${rollback ? 'rollback' : 'snapshot'} rejects unsupported hardlink storage before initializing history`, fixture => {
    const { skillDir, versionsDir } = fixture;
    if (rollback) {
      fs.mkdirSync(versionsDir);
      fs.writeFileSync(path.join(versionsDir, 'v1.md'), '# Saved target\n');
    }
    const linkSync = fs.linkSync;
    const primary = Object.assign(new Error('Injected unsupported hard links'), { code: 'EOPNOTSUPP' });
    fs.linkSync = () => { throw primary; };
    try {
      assert.throws(() => rollback ? versioning.rollbackTo(skillDir, 1) : versioning.createVersion(skillDir), error =>
        /requires hardlink-capable storage/.test(error.message) && error.primaryError === primary);
    } finally {
      fs.linkSync = linkSync;
    }
    assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Original\n');
    assert.equal(fs.existsSync(versioning.getEvolutionDir(skillDir)), false);
    if (rollback) {
      assert.deepEqual(fs.readdirSync(versionsDir), ['v1.md']);
      assert.equal(fs.readFileSync(path.join(versionsDir, 'v1.md'), 'utf8'), '# Saved target\n');
    } else assert.equal(fs.existsSync(versionsDir), false);
    assert.equal(fs.readdirSync(skillDir).filter(name => name.startsWith('.snapshot-')).length, 0);
    const snapshot = versioning.createVersion(skillDir);
    assert.equal(snapshot.version, rollback ? 2 : 1);
  });
}

test('successful rollback snapshots restored content and retains earlier targets for another rollback', fixture => {
  const { skillDir } = fixture;
  versioning.createVersion(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Second version\n');
  versioning.createVersion(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Unsnapshotted work\n');
  const restored = versioning.rollbackTo(skillDir, 1);
  assert.equal(restored.version, 3);
  assert.equal(fs.readFileSync(restored.path, 'utf8'), '# Original\n');
  assert.equal(fs.readFileSync(restored.path, 'utf8'), fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'));
  const second = versioning.rollbackTo(skillDir, 2);
  assert.equal(second.version, 4);
  assert.equal(fs.readFileSync(second.path, 'utf8'), '# Second version\n');
  assert.equal(fs.readFileSync(second.path, 'utf8'), fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'));
  assert.equal(versioning.getCurrentVersion(skillDir), 4);
});

console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
