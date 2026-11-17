const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const LEDGER = path.join(__dirname, '../../skills/story-lifecycle/scripts/ledger.js');
const temps = new Set();
const marker = '<!-- Derived from story files -->';
const epic = `# Epic: Auth\n\n${marker}\n| ID | Title | Status |\n| --- | --- | --- |\n`;
const story = (id, status = 'todo') => `# Story: ${id}\n\n**ID:** ${id}\n**Epic:** auth\n**Sprint:** unassigned\n**Status:** ${status}\n**Points:** 3\n`;
function run(root, args, preload) {
  return spawnSync(process.execPath, [...(preload ? ['-r', preload] : []), LEDGER, ...args, '--root', root],
    { encoding: 'utf8', timeout: 15000 });
}
function ok(result) { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
function input(root, changes) { const file = path.join(root, 'input.json'); fs.writeFileSync(file, JSON.stringify(changes)); return file; }
function snapshot(dir) {
  return Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name)).map(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return [entry.name, snapshot(file)];
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      assert.ok(fs.fstatSync(fd).isFile(), 'snapshot requires a regular file');
      return [entry.name, fs.readFileSync(fd, 'base64')];
    } finally { fs.closeSync(fd); }
  }));
}
function fixture(update = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ordinary-error-'));temps.add(root);
  execFileSync('git', ['init', '-q', root]);ok(run(root, ['init']));
  fs.writeFileSync(path.join(root, '.stories/epics/auth.md'), epic);
  const ids = ok(run(root, ['allocate', '--epic', 'auth', '--count', '2'])).ids;
  if (update) ok(run(root, ['apply', '--input', input(root, { create: Object.fromEntries(ids.map(id => [`${id}.md`, story(id)])) })]));
  const before = snapshot(path.join(root, '.stories'));
  const changes = { [update ? 'update' : 'create']: Object.fromEntries(ids.map(id => [`${id}.md`, story(id, update ? 'in-progress' : 'todo')])) };
  return { root, ids, before, registryBefore: snapshot(path.join(root, '.git/story-lifecycle')), file: input(root, changes) };
}
function fault(root, { recoveryFailure = false, cleanupFailure = false, journalRemovalFailure = false, releaseFailure = false } = {}) {
  const file = path.join(root, 'bounded-fault.cjs');
  fs.writeFileSync(file, `const fs=require('node:fs');const path=require('node:path');
const dir=${JSON.stringify(path.join(root, '.stories'))};const trace=${JSON.stringify(path.join(root, 'trace.json'))};
const state={published:0,recoveryLocks:[]};const save=()=>fs.writeFileSync(trace,JSON.stringify(state));
const failure=(text,code)=>Object.assign(new Error(text),{code});
for(const method of ['linkSync','renameSync']){const original=fs[method];fs[method]=function(source,target,...args){
 const publication=path.dirname(target)===dir && /^auth-[12]\\.md$/.test(path.basename(target)) && /^new-\\d+$/.test(path.basename(source));
 if(publication && state.published===1 && ${!cleanupFailure}){state.primary=true;state.firstBytes=fs.readFileSync(path.join(dir,'auth-1.md')).toString('base64');state.lock=JSON.parse(fs.readFileSync(path.join(dir,'.lock'),'utf8'));save();throw failure('PRIMARY ordinary second publication','EIO');}
 if(path.basename(source).startsWith('backup-')){const holder=JSON.parse(fs.readFileSync(path.join(dir,'.lock'),'utf8'));state.recoveryLocks.push(holder.pid===process.pid);save();
  if(${recoveryFailure} && path.basename(target)==='restore.tmp' && path.basename(source)==='backup-1')throw failure('RECOVERY backup restore refused','EACCES');}
 const result=original.call(fs,source,target,...args);if(publication){state.published++;save();}return result;
};}
${journalRemovalFailure ? "const rmJournal=fs.rmSync;fs.rmSync=function(target,...args){if(target===path.join(dir,'.txn','journal.json') && state.primary && state.recoveryLocks.length){throw failure('RECOVERY journal removal refused','EACCES');}return rmJournal.call(fs,target,...args);};" : ''}
${releaseFailure ? "const lstat=fs.lstatSync;fs.lstatSync=function(target,...args){if(target===path.join(dir,'.lock') && state.primary && state.recoveryLocks.length && !fs.existsSync(path.join(dir,'.txn'))){throw failure('RELEASE ownership read refused','EACCES');}return lstat.call(fs,target,...args);};" : ''}
${cleanupFailure ? "const rm=fs.rmSync;fs.rmSync=function(target,...args){if(target===path.join(dir,'.txn') && state.published===2 && fs.existsSync(target) && !fs.existsSync(path.join(dir,'.txn','journal.json'))){state.cleanup=true;save();throw failure('CLEANUP committed directory refused','EACCES');}return rm.call(fs,target,...args);};" : ''}
`);
  return file;
}
function restored(f) {
  assert.deepEqual(snapshot(path.join(f.root, '.stories')), f.before, 'every prior byte and new-file absence must match');
  assert.deepEqual(snapshot(path.join(f.root, '.git/story-lifecycle')), f.registryBefore);
  const state = ok(run(f.root, ['status']));assert.equal(state.recoveryPending, false);assert.equal(state.projectionAvailable, undefined);
  assert.deepEqual(state.drift, []);
}
const tests = [
  ['journal removal failure leaves restored bytes and a retryable journal', () => {
    const f = fixture(true);const result = run(f.root, ['apply', '--input', f.file], fault(f.root, { journalRemovalFailure: true }));
    assert.equal(result.status, 1);assert.match(result.stderr, /PRIMARY ordinary second publication/);assert.match(result.stderr, /RECOVERY journal removal refused/);assert.match(result.stderr, /recovery pending/i);
    const current = snapshot(path.join(f.root, '.stories'));const { '.txn': transaction, ...data } = current;assert.ok(transaction['journal.json']);assert.deepEqual(data, f.before);
    assert.equal(ok(run(f.root, ['status'])).recoveryPending, true);ok(run(f.root, ['recover']));restored(f);
  }],
  ['release failure preserves the primary error after successful rollback and permits stale-lock recovery', () => {
    const f = fixture(true);const result = run(f.root, ['apply', '--input', f.file], fault(f.root, { releaseFailure: true }));
    assert.equal(result.status, 1);assert.match(result.stderr, /PRIMARY ordinary second publication/);assert.match(result.stderr, /RELEASE ownership read refused/);
    const { '.lock': lock, ...data } = snapshot(path.join(f.root, '.stories'));assert.ok(lock);assert.deepEqual(data, f.before);
    ok(run(f.root, ['recover']));restored(f);
  }],
  ['failure after the committed journal marker does not undo a completed update', () => {
    const f = fixture(true);const result = run(f.root, ['apply', '--input', f.file], fault(f.root, { cleanupFailure: true }));
    assert.equal(result.status, 1);assert.match(result.stderr, /CLEANUP committed directory refused/);
    for (const id of f.ids) assert.equal(fs.readFileSync(path.join(f.root, '.stories', `${id}.md`), 'utf8'), story(id, 'in-progress'));
    assert.ok(!fs.existsSync(path.join(f.root, '.stories/.txn/journal.json')));
    assert.ok(!fs.existsSync(path.join(f.root, '.stories/.lock')));
    const trace = JSON.parse(fs.readFileSync(path.join(f.root, 'trace.json')));assert.equal(trace.published, 2);assert.deepEqual(trace.recoveryLocks, []);
    ok(run(f.root, ['recover']));assert.deepEqual(ok(run(f.root, ['status'])).drift, []);
    for (const id of f.ids) assert.equal(fs.readFileSync(path.join(f.root, '.stories', `${id}.md`), 'utf8'), story(id, 'in-progress'));
  }],
  ['crash70 preserves the pending journal for explicit recovery', () => {
    const f = fixture();const preload = path.join(f.root, 'crash.cjs');fs.writeFileSync(preload, "process.env.STORY_LEDGER_CRASH_AFTER='1';");
    assert.equal(run(f.root, ['apply', '--input', f.file], preload).status, 70);
    assert.ok(fs.existsSync(path.join(f.root, '.stories/.txn/journal.json')));
    ok(run(f.root, ['recover']));restored(f);
  }],
  ...[false, true].map(update => [`ordinary second ${update ? 'rename/update' : 'link/create'} failure restores the entire batch before returning`, () => {
    const f = fixture(update);const result = run(f.root, ['apply', '--input', f.file], fault(f.root, { update }));
    assert.equal(result.status, 1);assert.match(result.stderr, /PRIMARY ordinary second publication/);
    const trace = JSON.parse(fs.readFileSync(path.join(f.root, 'trace.json')));assert.equal(trace.published, 1);assert.equal(trace.lock.pid > 0, true);
    if (update) { assert.notEqual(trace.firstBytes, f.before['auth-1.md']);assert.ok(trace.recoveryLocks.length > 0);assert.ok(trace.recoveryLocks.every(Boolean)); }
    else assert.ok(trace.firstBytes);
    assert.ok(trace.recoveryLocks.length > 0);assert.ok(trace.recoveryLocks.every(Boolean));
    restored(f);
  }]),
  ['rollback failure reports both errors, retains journal, and explicit retry restores all bytes', () => {
    const f = fixture(true);const result = run(f.root, ['apply', '--input', f.file], fault(f.root, { recoveryFailure: true }));
    assert.equal(result.status, 1);assert.match(result.stderr, /PRIMARY ordinary second publication/);assert.match(result.stderr, /RECOVERY backup restore refused/);assert.match(result.stderr, /recovery pending/i);
    assert.ok(fs.existsSync(path.join(f.root, '.stories/.txn/journal.json')));assert.ok(!fs.existsSync(path.join(f.root, '.stories/.lock')));
    const trace = JSON.parse(fs.readFileSync(path.join(f.root, 'trace.json')));assert.ok(trace.recoveryLocks.length > 0);assert.ok(trace.recoveryLocks.every(Boolean));
    assert.equal(ok(run(f.root, ['status'])).recoveryPending, true);ok(run(f.root, ['recover']));restored(f);
  }],
];
let passed = 0;let failed = 0;
for (const [name, test] of tests) {
  try { test();console.log(`PASS ${name}`);passed++; } catch (error) { console.log(`FAIL ${name}: ${error.stack}`);failed++; }
  finally { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });temps.clear(); }
}
console.log(`Passed: ${passed}\nFailed: ${failed}`);process.exitCode = failed ? 1 : 0;
