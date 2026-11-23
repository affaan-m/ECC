'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { getSessionById } = require('../../scripts/lib/session-manager');

function fixture(t, history = 512) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-lookup-'));
  const home = path.join(root, 'data');
  const canonical = path.join(home, 'session-data');
  const legacy = path.join(home, 'sessions');
  fs.mkdirSync(canonical, { recursive: true });
  fs.mkdirSync(legacy);
  for (let index = 0; index < history; index++) {
    fs.writeFileSync(path.join(canonical, `2026-11-22-history-${index}-session.tmp`), '');
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (filename, content = '# Selected session\n', directory = canonical, seconds = 1600000000) => {
    const target = path.join(directory, filename);
    fs.writeFileSync(target, content);
    fs.utimesSync(target, seconds, seconds);
    return target;
  };
  const invoke = fn => {
    const previous = process.env.ECC_AGENT_DATA_HOME;
    process.env.ECC_AGENT_DATA_HOME = home;
    try { return fn(); } finally {
      if (previous === undefined) delete process.env.ECC_AGENT_DATA_HOME;
      else process.env.ECC_AGENT_DATA_HOME = previous;
    }
  };
  return { root, home, canonical, legacy, put, invoke };
}

function dateAllocations(fn) {
  const OriginalDate = global.Date;
  let count = 0;
  global.Date = new Proxy(OriginalDate, {
    construct(target, args, newTarget) {
      count++;
      return Reflect.construct(target, args, newTarget);
    }
  });
  try { return { value: fn(), count }; } finally { global.Date = OriginalDate; }
}

for (const [name, query, options] of [
  ['full filename', '2026-11-23-selected-session.tmp', {}],
  ['short ID', 'selected', {}],
  ['ID prefix', 'select', { matchBy: 'id' }],
  ['extensionless filename', '2026-11-23-selected-session', { matchBy: 'filename' }]
]) {
  test(name + ' avoids allocating dates for unrelated history', t => {
    const f = fixture(t);
    const target = f.put('2026-11-23-selected-session.tmp');
    const observed = f.invoke(() => dateAllocations(() => getSessionById(query, true, options)));
    assert.equal(observed.value.sessionPath, target);
    assert.equal(observed.value.metadata.title, 'Selected session');
    assert.ok(observed.count <= 8, `Unrelated history allocated ${observed.count} Date objects`);
  });
}

test('exact ID still wins over a newer prefix, and prefixes retain modification ordering', t => {
  const f = fixture(t, 3);
  const exact = f.put('2026-11-23-worker-session.tmp');
  const newer = f.put('2026-11-23-worker-next-session.tmp', '# Newer\n', f.canonical, 1700000000);
  f.invoke(() => {
    assert.equal(getSessionById('worker').sessionPath, exact);
    assert.equal(getSessionById('work').sessionPath, newer);
  });
});

test('automatic filename and short-ID collisions keep their existing tie-breaks', t => {
  const f = fixture(t, 3);
  const alias = '2026-11-23-task-session';
  const filename = f.put(alias + '.tmp');
  const id = f.put('2026-11-22-' + alias + '-session.tmp', '# Newer ID\n', f.canonical, 1700000000);
  f.invoke(() => {
    assert.equal(getSessionById(alias).sessionPath, id);
    assert.equal(getSessionById(alias, false, { matchBy: 'filename' }).sessionPath, filename);
    assert.equal(getSessionById(alias, false, { matchBy: 'id' }).sessionPath, id);
  });
});

test('legacy date aliases and full old-format filenames keep working', t => {
  const f = fixture(t, 3);
  const legacy = f.put('2026-10-10-session.tmp', '# Legacy\n', f.legacy);
  f.invoke(() => {
    for (const query of ['2026-10-10', '2026-10-10-session', '2026-10-10-session.tmp']) {
      assert.equal(getSessionById(query).sessionPath, legacy);
    }
    assert.equal(getSessionById('2026-10-10', false, { matchBy: 'filename' }), null);
  });
});

test('canonical duplicates take precedence and later calls observe changed files', t => {
  const f = fixture(t, 3);
  const name = '2026-11-23-selected-session.tmp';
  const canonical = f.put(name);
  const legacy = f.put(name, '# Newer legacy\n', f.legacy, 1700000000);
  f.invoke(() => {
    assert.equal(getSessionById(name).sessionPath, canonical);
    fs.unlinkSync(canonical);
    assert.equal(getSessionById(name).sessionPath, legacy);
    fs.writeFileSync(legacy, '# Changed\n');
    assert.equal(getSessionById(name, true).metadata.title, 'Changed');
  });
});

test('substring candidates still require valid dates, exact case and regular files', t => {
  const f = fixture(t, 3);
  f.put('2026-02-30-selected-session.tmp');
  f.put('2026-11-23-Selected-session.tmp');
  fs.mkdirSync(path.join(f.canonical, '2026-11-23-selected-dir-session.tmp'));
  f.invoke(() => {
    assert.equal(getSessionById('selected'), null);
    assert.equal(getSessionById('Selected').shortId, 'Selected');
    assert.equal(getSessionById('../selected'), null);
  });
});

test('matching symlinks remain excluded in favor of regular legacy files', t => {
  const f = fixture(t, 3);
  const name = '2026-11-23-selected-session.tmp';
  const legacy = f.put(name, '# Legacy\n', f.legacy);
  try { fs.symlinkSync(legacy, path.join(f.canonical, name)); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Symlinks unavailable'); return; }
    throw error;
  }
  assert.equal(f.invoke(() => getSessionById(name).sessionPath), legacy);
});

test('public session inspection preserves the snapshot with bounded metadata allocations', t => {
  const f = fixture(t);
  const name = '2026-11-23-selected-session.tmp';
  f.put(name, '# Selected session\n\n### Context to Load\n```\nsrc/selected.js\n```\n');
  const preload = path.join(f.root, 'allocations.cjs');
  const observations = path.join(f.root, 'allocations.json');
  fs.writeFileSync(preload, `const fs = require('node:fs');
const OriginalDate = Date;
let count = 0;
global.Date = new Proxy(OriginalDate, { construct(target, args, receiver) {
  count++; return Reflect.construct(target, args, receiver);
} });
process.on('exit', () => fs.writeFileSync(process.env.ECC_LOOKUP_OBSERVATIONS, JSON.stringify({ count })));
`);
  const child = spawnSync(process.execPath, ['--require', preload,
    path.resolve(__dirname, '../../scripts/session-inspect.js'), 'claude:' + name], {
    cwd: f.root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, ECC_AGENT_DATA_HOME: f.home,
      ECC_SESSION_RECORDING_DIR: path.join(f.root, 'recordings'), ECC_LOOKUP_OBSERVATIONS: observations }
  });
  assert.equal(child.status, 0, child.stderr);
  const snapshot = JSON.parse(child.stdout);
  assert.deepEqual(snapshot.workers[0].intent.seedPaths, ['src/selected.js']);
  assert.equal(snapshot.workers[0].artifacts.context, 'src/selected.js');
  const { count } = JSON.parse(fs.readFileSync(observations, 'utf8'));
  assert.ok(count <= 128, `CLI allocated ${count} Date objects for one selected session`);
});
