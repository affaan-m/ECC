/**
 * Tests for scripts/lib/capsule-recording.js
 *
 * Run with: node tests/lib/capsule-recording.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const {
  buildRecord,
  classifyEffect,
  isRecordingEnabled,
  openOrCreateCapsule,
  recordEvent,
  resolveCapsuleRoot,
} = require('../../scripts/lib/capsule-recording');
const { Capsule, CapsuleError, verify, readCapsule } = require('../../scripts/lib/eval-harness/capsule');

const SESSION = '0b6f3c1e-7d2a-4c55-9a41-2f8e6d0c9b13';
const tempRoots = [];
process.on('exit', () => {
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-capsule-recording-'));
  tempRoots.push(dir);
  return dir;
}

function recordingEnv(root, extra = {}) {
  return { ECC_CAPSULE_RECORDING: '1', ECC_CAPSULE_DIR: root, ...extra };
}

function toolEvent(overrides = {}) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: SESSION,
    tool_name: 'Bash',
    tool_use_id: 'toolu_01',
    tool_input: { command: 'export API_KEY=sk-live-abcdefghijklmnopqrstuvwx && npm test' },
    tool_response: { stdout: 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789', stderr: '' },
    ...overrides,
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

const tests = [];

tests.push(['recording is opt-in and accepts the hook-flags boolean words', () => {
  assert.strictEqual(isRecordingEnabled({}), false);
  assert.strictEqual(isRecordingEnabled({ ECC_CAPSULE_RECORDING: '0' }), false);
  assert.strictEqual(isRecordingEnabled({ ECC_CAPSULE_RECORDING: 'off' }), false);
  for (const value of ['1', 'true', 'YES', ' on ']) {
    assert.strictEqual(isRecordingEnabled({ ECC_CAPSULE_RECORDING: value }), true, value);
  }
}]);

tests.push(['capsule root defaults under the agent data home and honors ECC_CAPSULE_DIR', () => {
  const root = makeTempDir();
  assert.strictEqual(resolveCapsuleRoot({ ECC_CAPSULE_DIR: root }), path.resolve(root));
  assert.strictEqual(path.basename(resolveCapsuleRoot({})), 'capsules');
}]);

tests.push(['effect classes: read-only SE0, edits inside the work root SE1, everything else SE4', () => {
  const cwd = makeTempDir();
  assert.strictEqual(classifyEffect('Read', { file_path: '/etc/hosts' }, cwd), 'SE0');
  assert.strictEqual(classifyEffect('Grep', {}, cwd), 'SE0');
  assert.strictEqual(classifyEffect('Edit', { file_path: path.join(cwd, 'a.js') }, cwd), 'SE1');
  assert.strictEqual(classifyEffect('Write', { file_path: 'src/b.js' }, cwd), 'SE1');
  assert.strictEqual(classifyEffect('NotebookEdit', { notebook_path: 'n.ipynb' }, cwd), 'SE1');
  assert.strictEqual(classifyEffect('Write', { file_path: path.join(cwd, '..', 'x.js') }, cwd), 'SE4');
  assert.strictEqual(classifyEffect('Write', { file_path: cwd }, cwd), 'SE4');
  assert.strictEqual(classifyEffect('Edit', {}, cwd), 'SE4');
  for (const tool of ['Bash', 'PowerShell', 'WebFetch', 'Task', 'mcp__github__create_issue']) {
    assert.strictEqual(classifyEffect(tool, {}, cwd), 'SE4', tool);
  }
}]);

/** Create a symlink, or return false where the platform refuses (unprivileged Windows). */
function linkOrSkip(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return false;
    throw error;
  }
}

tests.push(['effect classes resolve symbolic links before declaring an edit SE1', () => {
  const cwd = makeTempDir();
  const outside = makeTempDir();
  fs.writeFileSync(path.join(outside, 'target.js'), '');
  if (!linkOrSkip(outside, path.join(cwd, 'linked'))) return;
  linkOrSkip(path.join(outside, 'target.js'), path.join(cwd, 'file-link.js'));
  linkOrSkip(path.join(outside, 'missing.js'), path.join(cwd, 'dangling.js'));
  assert.strictEqual(classifyEffect('Edit', { file_path: 'linked/a.js' }, cwd), 'SE4', 'directory link out of cwd');
  assert.strictEqual(classifyEffect('Edit', { file_path: 'file-link.js' }, cwd), 'SE4', 'file link out of cwd');
  assert.strictEqual(classifyEffect('Write', { file_path: 'dangling.js' }, cwd), 'SE4', 'dangling link cannot be checked');
  const cwdAlias = path.join(outside, 'cwd-alias');
  linkOrSkip(cwd, cwdAlias);
  assert.strictEqual(classifyEffect('Edit', { file_path: path.join(cwd, 'a.js') }, cwdAlias), 'SE1', 'cwd reached through a link');
  assert.strictEqual(classifyEffect('Write', { file_path: 'src/new/b.js' }, cwd), 'SE1', 'a target that does not exist yet');
}]);

tests.push(['a name that starts with two dots is not a parent segment', () => {
  const cwd = makeTempDir();
  assert.strictEqual(classifyEffect('Write', { file_path: '..cache/a.js' }, cwd), 'SE1');
  assert.strictEqual(classifyEffect('Write', { file_path: '...js' }, cwd), 'SE1');
  assert.strictEqual(classifyEffect('Write', { file_path: '..' }, cwd), 'SE4');
  assert.strictEqual(classifyEffect('Write', { file_path: path.join('..', 'a.js') }, cwd), 'SE4');
}]);

tests.push(['MultiEdit is SE1 only when every edits[].file_path is inside cwd too', () => {
  const cwd = makeTempDir();
  const outside = makeTempDir();
  const edit = (file_path) => ({ file_path, old_string: 'a', new_string: 'b' });
  assert.strictEqual(classifyEffect('MultiEdit', { file_path: 'a.js', edits: [edit(path.join(outside, 'x.js'))] }, cwd), 'SE4');
  assert.strictEqual(classifyEffect('MultiEdit', { edits: [edit('a.js'), edit(path.join(outside, 'x.js'))] }, cwd), 'SE4');
  assert.strictEqual(classifyEffect('MultiEdit', { edits: [edit('a.js'), edit('src/b.js')] }, cwd), 'SE1');
  assert.strictEqual(classifyEffect('MultiEdit', { file_path: 'a.js', edits: [{ old_string: 'a', new_string: 'b' }] }, cwd), 'SE1');
}]);

tests.push(['tool calls carry only the tool name, call id, digests and status', () => {
  const entry = buildRecord(toolEvent(), makeTempDir());
  assert.strictEqual(entry.lineage, 'interaction');
  assert.strictEqual(entry.kind, 'tool.call');
  assert.strictEqual(entry.effect_class, 'SE4');
  assert.deepStrictEqual(Object.keys(entry.payload).sort(),
    ['args_hash', 'response_hash', 'status', 'tool', 'tool_call_id']);
  assert.match(entry.payload.args_hash, /^[0-9a-f]{64}$/);
  assert.match(entry.payload.response_hash, /^[0-9a-f]{64}$/);
  assert.strictEqual(entry.payload.status, 'ok');
}]);

tests.push(['session boundaries keep a source or reason word and drop anything else', () => {
  const start = buildRecord({ hook_event_name: 'SessionStart', source: 'resume' }, '/');
  assert.deepStrictEqual(start, {
    lineage: 'environment', kind: 'session.start', payload: { note: 'resume' }, effect_class: 'SE0',
  });
  const end = buildRecord({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, '/');
  assert.deepStrictEqual(end.payload, { reason: 'prompt_input_exit' });
  const odd = buildRecord({ hook_event_name: 'SessionEnd', reason: 'Bearer abc def' }, '/');
  assert.deepStrictEqual(odd.payload, {});
}]);

tests.push(['events outside the three recorded hooks and nameless tools are ignored', () => {
  assert.strictEqual(buildRecord({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, '/'), null);
  assert.strictEqual(buildRecord({ hook_event_name: 'Stop' }, '/'), null);
  assert.strictEqual(buildRecord({ hook_event_name: 'PostToolUse' }, '/'), null);
}]);

tests.push(['a recorded session verifies and its journal holds no raw argument or output text', () => {
  const root = makeTempDir();
  const env = recordingEnv(root, { ECC_CAPSULE_TASK_FAMILY: 'slugify' });
  assert.strictEqual(recordEvent({ hook_event_name: 'SessionStart', session_id: SESSION, source: 'startup' }, env, root), '');
  assert.strictEqual(recordEvent(toolEvent(), env, root), '');
  assert.strictEqual(recordEvent({ hook_event_name: 'SessionEnd', session_id: SESSION, reason: 'logout' }, env, root), '');
  const dir = path.join(root, SESSION);
  const result = verify(dir);
  assert.strictEqual(result.ok, true, result.code);
  const state = readCapsule(dir);
  assert.deepStrictEqual(state.entries.map(entry => entry.kind), ['session.start', 'tool.call', 'session.end']);
  assert.strictEqual(state.meta.run_id, SESSION);
  assert.strictEqual(state.meta.capsule_id, SESSION);
  assert.strictEqual(state.meta.task_family, 'slugify');
  const bytes = fs.readFileSync(path.join(dir, 'journal.ndjson'), 'utf8');
  for (const leaked of ['sk-live', 'ghp_', 'API_KEY', 'npm test']) {
    assert.ok(!bytes.includes(leaked), `journal must not contain ${leaked}`);
  }
}]);

tests.push(['missing or non-id session ids are reported and write nothing', () => {
  const root = makeTempDir();
  const env = recordingEnv(root);
  for (const session_id of [undefined, '', '../escape', 'a/b', '-leading-dash']) {
    const message = recordEvent(toolEvent({ session_id }), env, root);
    assert.match(message, /^\[CapsuleRecorder\] skipped: session_id/);
  }
  assert.deepStrictEqual(fs.readdirSync(root), []);
}]);

tests.push(['the journal size cap stops appends and says so', () => {
  const root = makeTempDir();
  const env = recordingEnv(root, { ECC_CAPSULE_MAX_BYTES: '1' });
  assert.strictEqual(recordEvent(toolEvent(), env, root), '');
  const journal = path.join(root, SESSION, 'journal.ndjson');
  const before = fs.readFileSync(journal);
  assert.match(recordEvent(toolEvent({ tool_use_id: 'toolu_02' }), env, root), /ECC_CAPSULE_MAX_BYTES \(1\)/);
  assert.deepStrictEqual(fs.readFileSync(journal), before);
}]);

tests.push(['the cap is checked again after waiting for a sibling that crossed it', () => {
  const root = makeTempDir();
  assert.strictEqual(recordEvent(toolEvent(), recordingEnv(root), root), '');
  const dir = path.join(root, SESSION);
  const journal = path.join(dir, 'journal.ndjson');
  const env = recordingEnv(root, { ECC_CAPSULE_MAX_BYTES: String(fs.statSync(journal).size + 1) });
  const realAppend = Capsule.prototype.append;
  let siblingAppended = false;
  Capsule.prototype.append = function appendAfterSibling(...args) {
    if (!siblingAppended) {
      siblingAppended = true;
      realAppend.call(Capsule.open(dir), 'interaction', 'tool.call', { tool: 'Bash', tool_call_id: 'toolu_sibling', status: 'ok' }, { effect_class: 'SE4' });
      throw new CapsuleError('capsule.busy', 'capsule append lock is already held');
    }
    return realAppend.apply(this, args);
  };
  let diagnostic;
  try {
    diagnostic = recordEvent(toolEvent({ tool_use_id: 'toolu_queued' }), env, root);
  } finally {
    Capsule.prototype.append = realAppend;
  }
  assert.ok(siblingAppended, 'the contention path was not exercised');
  assert.match(diagnostic, /ECC_CAPSULE_MAX_BYTES/);
  assert.deepStrictEqual(readCapsule(dir).entries.map(entry => entry.payload.tool_call_id), ['toolu_01', 'toolu_sibling']);
}]);

/** A capsule with one entry, plus the exact bytes of a valid second entry. */
function capsuleWithNextLine() {
  const root = makeTempDir();
  assert.strictEqual(recordEvent(toolEvent(), recordingEnv(root), root), '');
  const copy = makeTempDir();
  fs.cpSync(path.join(root, SESSION), path.join(copy, SESSION), { recursive: true });
  assert.strictEqual(recordEvent(toolEvent({ tool_use_id: 'toolu_02' }), recordingEnv(copy), copy), '');
  const lines = fs.readFileSync(path.join(copy, SESSION, 'journal.ndjson'), 'utf8').split(/(?<=\n)/);
  return { root, dir: path.join(root, SESSION), nextLine: lines[1] };
}

tests.push(['opening while a sibling append is mid-write waits for it instead of refusing the journal', () => {
  const { root, dir, nextLine } = capsuleWithNextLine();
  const journal = path.join(dir, 'journal.ndjson');
  const lock = path.join(dir, '.append.lock');
  const half = Math.floor(nextLine.length / 2);
  fs.writeFileSync(lock, '');
  fs.appendFileSync(journal, nextLine.slice(0, half));
  const finisher = spawn(process.execPath, ['-e',
    'const fs=require("fs");const [j,l,rest]=process.argv.slice(1);'
    + 'setTimeout(()=>{fs.appendFileSync(j,rest);fs.rmSync(l)},150);',
    journal, lock, nextLine.slice(half)], { stdio: 'ignore' });
  try {
    assert.strictEqual(recordEvent(toolEvent({ tool_use_id: 'toolu_03' }), recordingEnv(root), root), '');
  } finally {
    finisher.kill();
  }
  assert.strictEqual(verify(dir).ok, true);
  assert.deepStrictEqual(readCapsule(dir).entries.map(entry => entry.payload.tool_call_id), ['toolu_01', 'toolu_02', 'toolu_03']);
}]);

tests.push(['a truncated tail with no append in flight is still refused', () => {
  const { root, dir, nextLine } = capsuleWithNextLine();
  const journal = path.join(dir, 'journal.ndjson');
  fs.appendFileSync(journal, nextLine.slice(0, 20));
  const before = fs.readFileSync(journal);
  assert.throws(() => recordEvent(toolEvent({ tool_use_id: 'toolu_03' }), recordingEnv(root), root),
    error => error.code === 'capsule.truncated_tail');
  assert.deepStrictEqual(fs.readFileSync(journal), before);
}]);

tests.push(['a damaged journal is refused and left unchanged', () => {
  const root = makeTempDir();
  const env = recordingEnv(root);
  recordEvent(toolEvent(), env, root);
  const journal = path.join(root, SESSION, 'journal.ndjson');
  fs.appendFileSync(journal, '{"partial":');
  const damaged = fs.readFileSync(journal);
  assert.throws(() => recordEvent(toolEvent({ tool_use_id: 'toolu_02' }), env, root),
    error => error.code === 'capsule.truncated_tail');
  assert.deepStrictEqual(fs.readFileSync(journal), damaged);
}]);

tests.push(['opening an existing capsule keeps its metadata', () => {
  const dir = path.join(makeTempDir(), SESSION);
  const meta = { run_id: SESSION, capsule_id: SESSION, harness_version: '1.0.0', task_family: 'first' };
  const first = openOrCreateCapsule(dir, meta);
  const second = openOrCreateCapsule(dir, { ...meta, task_family: 'second' });
  assert.strictEqual(second.meta.task_family, 'first');
  assert.strictEqual(second.meta.created_at, first.meta.created_at);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(dir)), [SESSION], 'no staging directory may remain');
}]);

tests.push(['losing the first-create race keeps the winner\'s journal', () => {
  const root = makeTempDir();
  const dir = path.join(root, SESSION);
  const winnerEvent = toolEvent({ tool_use_id: 'toolu_winner' });
  // Another hook process creates the capsule after this process's existence
  // checks and before its first metadata write lands.
  const realWriteFileSync = fs.writeFileSync;
  let raced = false;
  fs.writeFileSync = (...args) => {
    if (!raced && path.basename(String(args[0])) === 'capsule.json') {
      raced = true;
      recordEvent(winnerEvent, recordingEnv(root), root);
    }
    return realWriteFileSync(...args);
  };
  let capsule;
  try {
    capsule = openOrCreateCapsule(dir, { run_id: SESSION, capsule_id: SESSION, task_family: 'late' });
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }
  assert.ok(raced, 'the race path was not exercised');
  assert.strictEqual(capsule.meta.task_family, 'session');
  assert.deepStrictEqual(readCapsule(dir).entries.map(entry => entry.payload.tool_call_id), ['toolu_winner']);
  assert.deepStrictEqual(fs.readdirSync(root), [SESSION], 'no staging directory may remain');
}]);

let passed = 0;
let failed = 0;
console.log('\n=== Testing capsule-recording.js ===\n');
for (const [name, fn] of tests) {
  if (test(name, fn)) passed += 1; else failed += 1;
}
console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
