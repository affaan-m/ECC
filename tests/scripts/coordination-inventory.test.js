'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeManifest, buildInventory, collectResources, collectTaskFiles, readJson } = require('../../scripts/lib/coordination-inventory');
const now = '2026-09-08T06:30:00.000Z';
const task = (id, paths, extra = {}) => ({ id, repoId: 'repo', paths, ...extra });
const fixture = () => ({ version: 1, repositories: [{ id: 'repo', sources: { 'src/a.js': "require('../lib/b')", 'lib/b.js': '' } }], tasks: [task('a', ['src/a.js']), task('b', ['lib/b.js'])], leases: [] });
const run = value => buildInventory(value, { now });

test('direct import warns when exact-path baseline would miss it; deterministic JSON', () => {
  const f = fixture(); const before = JSON.stringify(f); const r = run(f);
  assert.equal(r.warnings.length, 1); assert.deepEqual(r.warnings[0].reasons, ['import_dependency']);
  assert.equal(r.warnings[0].channels.dependency, 1);
  assert.equal(JSON.stringify(run(f)), JSON.stringify(r)); assert.equal(JSON.stringify(f), before);
});
test('normalized exact paths warn, tree-only neighbors and cross-repo pairs do not', () => {
  const f = fixture(); f.tasks[1].paths = ['./src/a.js'];
  assert.deepEqual(run(f).warnings[0].reasons, ['path_overlap']);
  f.tasks[1].paths = ['src/c.js']; assert.equal(run(f).warnings.length, 0);
  f.repositories.push({ id: 'other', sources: {} }); f.tasks[1] = task('b', ['src/a.js'], { repoId: 'other' });
  assert.equal(run(f).warnings.length, 0);
});
test('leases show owner, expiry, conflicts and do not grant authority', () => {
  const f = fixture(); f.leases = [
    { resource: 'browser:chrome', owner: 'root', expiresAt: '2026-09-08T07:00:00Z' },
    { resource: 'browser:chrome', owner: 'worker', expiresAt: '2026-09-08T07:00:00Z' },
    { resource: 'browser:chrome', owner: 'old', expiresAt: now }
  ]; const r = run(f);
  assert.equal(r.leases[2].state, 'expired');
  assert.deepEqual(r.leaseConflicts, [{ resource: 'browser:chrome', owners: ['root', 'worker'] }]);
  assert.equal(r.mode, 'read-only'); assert.equal(r.leases[0].authority, 'declared-only');
});
test('stale heartbeat is not a proven stuck process; absent/future telemetry stays unknown', () => {
  const f = fixture(); f.tasks = [task('a', [], { heartbeatAt: '2026-09-08T06:00:00Z', pid: 12 }), task('b', [], { heartbeatAt: '2026-09-08T07:00:00Z' }), task('c', [])];
  const r = run(f); assert.equal(r.tasks[0].heartbeat.state, 'stale'); assert.equal(r.tasks[0].process.state, 'unknown');
  assert.equal(r.tasks[1].heartbeat.state, 'clock-skew'); assert.equal(r.tasks[2].heartbeat.state, 'unknown');
});
test('task parents, status and bounded observations survive without source payload', () => {
  const f = fixture(); f.tasks[1].parentId = 'a'; f.tasks[0].status = 'running'; f.tasks[0].unexpectedSecret = 'CANARY_SECRET';
  f.repositories[0].sources['lib/b.js'] = 'CANARY_SOURCE';
  const r = run(f); assert.equal(r.tasks[1].parentId, 'a'); assert.equal(r.tasks[0].status, 'running');
  assert.ok(!JSON.stringify(r).includes('CANARY')); assert.equal(r.coverage.workingSets, 'declared-paths-only');
});
test('invalid shapes, IDs, paths, dates and missing repos fail closed', () => {
  for (const mutate of [
    f => { f.version = 2; }, f => { f.tasks = null; }, f => { f.tasks.push(f.tasks[0]); },
    f => { f.tasks[0].paths = ['../escape']; }, f => { f.tasks[0].paths = ['/absolute']; },
    f => { f.tasks[0].paths = ['C:\\secret']; }, f => { f.tasks[0].paths = ['a/../b']; },
    f => { f.tasks[0].paths = ['__proto__']; }, f => { f.tasks[0].pid = '-1'; },
    f => { f.tasks[0].heartbeatAt = 'yesterday'; }, f => { f.tasks[0].repoId = 'absent'; },
    f => { f.repositories[0].sources = []; }, f => { f.tasks[0].id = '\n'; },
    f => { f.tasks[0].parentId = 'a'; }, f => { f.tasks = Array(65).fill(f.tasks[0]); },
    f => { f.leases = [{resource:'chrome',owner:'root',expiresAt:'bad'}]; }
  ]) { const f = fixture(); mutate(f); assert.throws(() => normalizeManifest(f), /Invalid/); }
});
test('process collection uses metadata-only argv, bounded timeout and no shell', () => {
  let call; const r = collectResources([task('a', [], { pid: 12 })], { platform: 'darwin', totalmem: () => 1024, freemem: () => 512, execFileSync: (...args) => { call = args; return '12 1 32 01:30 S\n'; } });
  assert.equal(call[0], 'ps'); assert.deepEqual(call[1], ['-p','12','-o','pid=,ppid=,rss=,etime=,stat=']);
  assert.equal(call[2].timeout, 2000); assert.equal(call[2].shell, false);
  assert.equal(r.processes[0].rssBytes, 32768); assert.equal(r.memory.freeBytes, 512);
});
test('unavailable, empty, malformed and unsupported process snapshots remain explicit', () => {
  const tasks = [task('a', [], { pid: 12 })];
  let runnerCalls = 0;
  const unsupportedDeps = { platform: 'win32', execFileSync: () => { runnerCalls += 1; return ''; } };
  const unsupported = collectResources(tasks, unsupportedDeps);
  assert.equal(unsupported.processStatus, 'unsupported');
  assert.equal(buildInventory({ ...fixture(), tasks }, { now, resources: unsupported }).tasks[0].process.state, 'unknown');
  // Runner fixtures must select a supported platform independently of the host.
  assert.equal(collectResources(tasks, { platform: 'darwin', execFileSync: () => { throw new Error('SECRET'); } }).processStatus, 'unavailable');
  assert.equal(collectResources(tasks, { platform: 'darwin', execFileSync: () => '' }).processStatus, 'ok');
  assert.equal(collectResources(tasks, { platform: 'darwin', execFileSync: () => 'bad row' }).processStatus, 'unavailable');
  assert.equal(collectResources([], unsupportedDeps).processStatus, 'not-requested');
  assert.equal(runnerCalls, 0);
});
test('live process snapshot enriches matching tasks and marks missing PID as unobserved', () => {
  const f = fixture(); f.tasks[0].pid = 12; f.tasks[1].pid = 13;
  const resources = collectResources(f.tasks, { platform: 'linux', execFileSync: () => '12 1 32 01:30 S\n' });
  const r = buildInventory(f, { now, resources });
  assert.equal(r.tasks[0].process.state, 'observed'); assert.equal(r.tasks[1].process.state, 'not-observed');
});
test('task file adapter reads structured status, labels mtime, skips symlinks and rejects oversized JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordination-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'worker')); fs.writeFileSync(path.join(dir, 'worker', 'STATUS.md'), '- State: running\n- Updated: 2026-09-08T06:29:00Z\n');
    fs.symlinkSync(path.join(dir, 'worker'), path.join(dir, 'linked'));
    const r = collectTaskFiles(dir); assert.equal(r.tasks.length, 1); assert.equal(r.tasks[0].status, 'running');
    assert.ok(r.tasks[0].statusFileModifiedAt); assert.equal(r.tasks[0].heartbeatAt, '2026-09-08T06:29:00Z');
    fs.writeFileSync(path.join(dir, 'large.json'), ' '.repeat(1024 * 1024 + 1));
    assert.throws(() => readJson(path.join(dir, 'large.json')), /limit/);
    assert.equal(collectTaskFiles(path.join(dir, 'missing')).status, 'unavailable');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('CLI JSON end to end, no output file changes and safe errors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordination-cli-'));
  const cli = path.resolve(__dirname, '../../scripts/coordination-inventory.js');
  try {
    const file = path.join(dir,'input.json'); fs.writeFileSync(file, JSON.stringify(fixture()));
    const r = spawnSync(process.execPath, [cli, '--manifest', file, '--now', now], { encoding:'utf8' });
    assert.equal(r.status,0,r.stderr); assert.equal(JSON.parse(r.stdout).warnings.length,1);
    assert.deepEqual(fs.readdirSync(dir),['input.json']);
    const bad = spawnSync(process.execPath,[cli,'--unknown','CANARY_SECRET'],{encoding:'utf8'});
    assert.equal(bad.status,1); assert.ok(!bad.stderr.includes('CANARY_SECRET'));
    const help = spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'}); assert.equal(help.status,0);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('prototype-named paths and strict calendar dates are safe', () => {
  const f = fixture(); f.repositories[0].sources = {}; f.tasks[0].paths = ['toString']; f.tasks[1].paths = ['valueOf'];
  assert.equal(run(f).warnings.length, 0);
  for (const invalid of ['2026-02-30T00:00:00Z', '2026-09-08T24:00:00Z']) {
    f.tasks[0].heartbeatAt = invalid; assert.throws(() => run(f), /Invalid/);
  }
  f.tasks[0].heartbeatAt = '2026-09-08T06:00:00.1Z'; assert.equal(run(f).tasks[0].heartbeat.state, 'stale');
});
test('aggregate comparison budget rejects compact but computationally excessive input', () => {
  const f = fixture(); f.repositories[0].sources = {};
  f.tasks = Array.from({length:64}, (_,i) => task(`task${i}`, Array.from({length:128}, (_,j) => `src/${i}/${j}.js`)));
  assert.throws(() => run(f), /budget/);
});
test('CLI discovery composes normalized tasks and reports missing telemetry honestly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordination-discovery-'));
  try {
    fs.mkdirSync(path.join(dir,'worker')); fs.writeFileSync(path.join(dir,'worker','STATUS.md'),'Freeform progress.\n');
    const r = spawnSync(process.execPath,[path.resolve(__dirname,'../../scripts/coordination-inventory.js'),'--coordination',dir,'--now',now],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr); const report=JSON.parse(r.stdout);
    assert.equal(report.tasks[0].status,'unknown'); assert.equal(report.tasks[0].heartbeat.state,'unknown');
    assert.ok(report.tasks[0].statusFileModifiedAt); assert.equal(report.tasks[0].process.state,'unknown');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('source snippets are bounded before invoking inherited regex extractor', () => {
  const f = fixture(); f.repositories[0].sources = { 'a.js': `import ${' '.repeat(32000)}x` }; f.tasks=[];
  assert.throws(() => run(f), /Invalid/);
  f.repositories[0].sources = Object.fromEntries(Array.from({length:33},(_,i) => [`${i}.js`, ' '.repeat(1024)]));
  assert.throws(() => run(f), /Invalid/);
});
test('maximum accepted whitespace snippets complete within bounded subprocess timeout', () => {
  const code = `const {buildInventory}=require('./scripts/lib/coordination-inventory');
    const source='import '+' '.repeat(1016)+'x';
    const sources=Object.fromEntries(Array.from({length:32},(_,i)=>[i+'.js',source]));
    const r=buildInventory({version:1,repositories:[{id:'r',sources}],tasks:[{id:'a',repoId:'r',paths:['0.js']},{id:'b',repoId:'r',paths:['1.js']}]});
    if(r.warnings.length) process.exitCode=1;`;
  const r=spawnSync(process.execPath,['-e',code],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8',timeout:2000});
  assert.equal(r.status,0,r.error?.message || r.stderr);
});
test('bounded import parsing preserves supported JS and TS import forms', () => {
  const { buildDependencyGraphFromSources } = require('../../scripts/lib/agent-proximity/graph');
  for (const source of ["import './b'", "import b from './b'", "import { b as c } from './b'", "import * as b from './b'", "import b, { c } from './b'", "import type { B } from './b'", "import {\n b\n} from './b'", "import('./b')"]) {
    assert.deepEqual(buildDependencyGraphFromSources({'a.js':source,'b.js':''}).adjacency['a.js'],['b.js']);
  }
});
