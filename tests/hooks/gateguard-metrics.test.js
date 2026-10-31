/**
 * Tests for opt-in GateGuard decision metrics written by scripts/hooks/gateguard-fact-force.js
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
const SESSION_ID = 'gateguard-metrics-session';
const SESSION_HASH = crypto.createHash('sha256').update(SESSION_ID).digest('hex').slice(0, 12);
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-metrics-'));
const projectRoot = path.join(tmpBase, 'fixture-project-zqx');
const stateDir = path.join(tmpBase, 'state');
const metricsFile = path.join(stateDir, 'metrics.jsonl');
const transcriptDir = path.join(tmpBase, 'transcripts');
fs.mkdirSync(path.join(projectRoot, 'src', 'widgets'), { recursive: true });
fs.mkdirSync(transcriptDir, { recursive: true });

const FIXTURE_STRINGS = [
  'fixture-project-zqx',
  'secret-widget-alpha',
  'quiet-helper-beta',
  'credited-gamma',
  'nearmiss-delta',
  'scaffold-epsilon',
  'scaffold-zeta',
  'capped-eta',
  'exempt-theta',
  'subagent-iota',
  'multi-kappa',
  'multi-lambda',
  'token-mu-echo',
  'token-nu-rm',
  'token-xi-ls',
  'token-omicron-ps',
  'CODE-BODY-PI',
  'COMMENT-BODY-RHO'
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function resetState() {
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.mkdirSync(stateDir, { recursive: true });
}

function runHook(hookId, payload, env = {}) {
  const result = spawnSync('node', [runner, hookId, 'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
    input: JSON.stringify({ cwd: projectRoot, ...payload }),
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      GATEGUARD_STATE_DIR: stateDir,
      CLAUDE_SESSION_ID: SESSION_ID,
      CLAUDE_PROJECT_DIR: projectRoot,
      CLAUDE_TRANSCRIPT_PATH: '',
      GATEGUARD_METRICS: '1',
      ...env
    },
    timeout: 15000
  });
  let decision = 'pass';
  try {
    const output = JSON.parse(result.stdout);
    if (output && output.hookSpecificOutput && output.hookSpecificOutput.permissionDecision) {
      decision = output.hookSpecificOutput.permissionDecision;
    }
  } catch (_) {
    decision = 'pass';
  }
  return { status: result.status, decision, stdout: result.stdout || '' };
}

function edit(filePath, oldString = 'const a = 1;', newString = 'const a = 2;', extra = {}, env = {}) {
  return runHook(
    'pre:edit-write:gateguard-fact-force',
    { tool_name: 'Edit', tool_input: { file_path: filePath, old_string: oldString, new_string: newString }, ...extra },
    env
  );
}

function write(filePath, content, extra = {}, env = {}) {
  return runHook('pre:edit-write:gateguard-fact-force', { tool_name: 'Write', tool_input: { file_path: filePath, content }, ...extra }, env);
}

function bash(command, env = {}) {
  return runHook('pre:bash:gateguard-fact-force', { tool_name: 'Bash', tool_input: { command } }, env);
}

function powershell(command, env = {}) {
  return runHook('pre:powershell:gateguard-fact-force', { tool_name: 'PowerShell', tool_input: { command } }, env);
}

function readEvents() {
  if (!fs.existsSync(metricsFile)) return [];
  return fs
    .readFileSync(metricsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function lastEvent() {
  const events = readEvents();
  return events[events.length - 1];
}

let transcriptSeq = 0;
function writeTranscript(searches) {
  transcriptSeq += 1;
  const records = [{ type: 'user', uuid: `u-${transcriptSeq}-0`, message: { role: 'user', content: 'fix it' } }];
  searches.forEach(([name, input], index) => {
    const id = `toolu_${transcriptSeq}_${index}`;
    records.push({
      type: 'assistant',
      uuid: `u-${transcriptSeq}-a${index}`,
      message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
    });
    records.push({
      type: 'user',
      uuid: `u-${transcriptSeq}-r${index}`,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: 'ok' }] }
    });
  });
  const pendingId = `toolu_pending_${transcriptSeq}`;
  records.push({
    type: 'assistant',
    uuid: `u-${transcriptSeq}-p`,
    message: { id: `msg_${pendingId}`, role: 'assistant', content: [{ type: 'tool_use', id: pendingId, name: 'Edit', input: {} }] }
  });
  const file = path.join(transcriptDir, `t-${transcriptSeq}.jsonl`);
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return { transcript_path: file, tool_use_id: pendingId };
}

const src = name => path.join(projectRoot, 'src', name);

function seed(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

console.log('\n=== Testing GateGuard decision metrics ===\n');

test('writes no metrics file when GATEGUARD_METRICS is unset', () => {
  resetState();
  assert.strictEqual(edit(src('secret-widget-alpha.js'), 'a', 'b', {}, { GATEGUARD_METRICS: '' }).decision, 'deny');
  assert.strictEqual(bash('echo token-mu-echo', { GATEGUARD_METRICS: '' }).decision, 'deny');
  assert.strictEqual(fs.existsSync(metricsFile), false);
});

test('writes no metrics file for values outside the truthy set', () => {
  resetState();
  for (const value of ['0', 'false', 'off', 'nope']) {
    edit(src(`secret-widget-alpha-${value}.js`), 'a', 'b', {}, { GATEGUARD_METRICS: value });
  }
  assert.strictEqual(fs.existsSync(metricsFile), false);
});

test('accepts the truthy spellings used by other GateGuard switches', () => {
  for (const value of ['1', 'true', ' Yes ', 'on', 'enabled', 'enable']) {
    resetState();
    edit(src('secret-widget-alpha.js'), 'a', 'b', {}, { GATEGUARD_METRICS: value });
    assert.strictEqual(readEvents().length, 1, `value ${JSON.stringify(value)}`);
  }
});

test('records a first-touch denial with schema, session hash, class, questions and profile', () => {
  resetState();
  assert.strictEqual(edit(src('secret-widget-alpha.js'), 'const a = 1;', 'const a = 2;').decision, 'deny');
  const events = readEvents();
  assert.strictEqual(events.length, 1);
  const event = events[0];
  assert.deepStrictEqual(Object.keys(event).sort(), ['class', 'decision', 'profile', 'questions', 'reason', 'sensitive', 'session', 'tool', 'ts', 'v']);
  assert.strictEqual(event.v, 1);
  assert.ok(!Number.isNaN(Date.parse(event.ts)));
  assert.strictEqual(event.session, SESSION_HASH);
  assert.strictEqual(event.tool, 'Edit');
  assert.strictEqual(event.class, 'code');
  assert.strictEqual(event.decision, 'deny');
  assert.strictEqual(event.reason, 'first-touch');
  assert.strictEqual(event.sensitive, false);
  assert.deepStrictEqual(event.questions, ['local-callers', 'quote-instruction']);
  assert.deepStrictEqual(event.profile, { known: true, language: 'js', touchesPublicSurface: false, touchesData: false, trivial: false });
});

test('records a pass for an already checked file', () => {
  edit(src('secret-widget-alpha.js'));
  const event = lastEvent();
  assert.strictEqual(event.decision, 'pass-checked');
  assert.strictEqual(event.reason, 'checked');
  assert.strictEqual(event.class, 'code');
  assert.strictEqual(event.questions, null);
  assert.strictEqual(event.profile, null);
});

test('records a sensitive denial with the full question set', () => {
  resetState();
  assert.strictEqual(edit(path.join(projectRoot, '.env.local'), 'A=1', 'A=2').decision, 'deny');
  const event = lastEvent();
  assert.strictEqual(event.decision, 'deny');
  assert.strictEqual(event.reason, 'sensitive');
  assert.strictEqual(event.sensitive, true);
  assert.strictEqual(event.class, 'config');
  assert.deepStrictEqual(event.questions, ['config-reader', 'config-effect', 'no-plaintext-secrets', 'quote-instruction']);
});

test('records a comment-only edit as trivial', () => {
  resetState();
  seed(src('quiet-helper-beta.js'), 'run(); // COMMENT-BODY-RHO old\n');
  const result = edit(src('quiet-helper-beta.js'), 'run(); // COMMENT-BODY-RHO old', 'run(); // COMMENT-BODY-RHO new');
  assert.strictEqual(result.decision, 'pass');
  const event = lastEvent();
  assert.strictEqual(event.decision, 'trivial');
  assert.strictEqual(event.reason, 'comment-whitespace');
  assert.strictEqual(event.profile.trivial, true);
});

test('records prior-search credit', () => {
  resetState();
  const turn = writeTranscript([['Grep', { pattern: 'credited-gamma', path: path.join(projectRoot, 'src') }]]);
  assert.strictEqual(edit(src('credited-gamma.js'), 'a', 'b', turn).decision, 'pass');
  const event = lastEvent();
  assert.strictEqual(event.decision, 'credit');
  assert.strictEqual(event.reason, 'prior-search');
  assert.strictEqual(event.class, 'code');
});

test('records a near-miss denial with the miss code', () => {
  resetState();
  const turn = writeTranscript([['Grep', { pattern: 'nearmiss-delta', path: path.join(projectRoot, 'docs') }]]);
  assert.strictEqual(edit(src('nearmiss-delta.js'), 'a', 'b', turn).decision, 'deny');
  const event = lastEvent();
  assert.strictEqual(event.decision, 'deny');
  assert.strictEqual(event.reason, 'near-miss:out-of-scope');
});

test('records sibling collapse for a second new file in the same directory', () => {
  resetState();
  assert.strictEqual(write(path.join(projectRoot, 'src', 'widgets', 'scaffold-epsilon.js'), 'CODE-BODY-PI').decision, 'deny');
  assert.strictEqual(write(path.join(projectRoot, 'src', 'widgets', 'scaffold-zeta.js'), 'CODE-BODY-PI').decision, 'pass');
  const events = readEvents();
  assert.deepStrictEqual(events.map(e => e.decision), ['deny', 'sibling']);
  assert.deepStrictEqual(events[0].questions, ['callers', 'no-duplicate', 'quote-instruction']);
  assert.strictEqual(events[1].reason, 'same-turn-dir');
});

test('records the denial cap', () => {
  resetState();
  assert.strictEqual(edit(src('capped-eta.js'), 'a', 'b', {}, { GATEGUARD_FACT_FORCE_MAX_DENIALS: '0' }).decision, 'pass');
  const event = lastEvent();
  assert.strictEqual(event.decision, 'cap');
  assert.strictEqual(event.reason, 'max-denials');
});

test('records exempt and subagent passes', () => {
  resetState();
  edit(src('exempt-theta.js'), 'a', 'b', {}, { GATEGUARD_EXEMPT_GLOBS: 'src/exempt-*.js' });
  edit(src('subagent-iota.js'), 'a', 'b', { agent_id: 'agent-1' });
  const events = readEvents();
  assert.deepStrictEqual(
    events.map(e => [e.decision, e.reason]),
    [
      ['pass-exempt', 'exempt-glob'],
      ['pass-subagent', 'subagent']
    ]
  );
});

test('records a subagent denial on a sensitive target', () => {
  resetState();
  assert.strictEqual(edit(path.join(projectRoot, 'src', 'auth', 'subagent-iota.js'), 'a', 'b', { agent_id: 'agent-1' }).decision, 'deny');
  const event = lastEvent();
  assert.strictEqual(event.decision, 'deny');
  assert.strictEqual(event.reason, 'subagent-sensitive');
  assert.strictEqual(event.sensitive, true);
});

test('records one line per file decided by a MultiEdit call', () => {
  resetState();
  seed(src('multi-kappa.js'), 'x(); // a\ny(); // a\n');
  const result = runHook('pre:edit-write:gateguard-fact-force', {
    tool_name: 'MultiEdit',
    tool_input: {
      edits: [
        { file_path: src('multi-kappa.js'), old_string: 'x(); // a', new_string: 'x(); // b' },
        { file_path: src('multi-kappa.js'), old_string: 'y(); // a', new_string: 'y(); // b' },
        { file_path: src('multi-lambda.js'), old_string: 'a', new_string: 'b' }
      ]
    }
  });
  assert.strictEqual(result.decision, 'deny');
  const events = readEvents();
  assert.deepStrictEqual(events.map(e => [e.tool, e.decision]), [
    ['MultiEdit', 'trivial'],
    ['MultiEdit', 'deny']
  ]);
});

test('records shell decisions for Bash and PowerShell', () => {
  resetState();
  assert.strictEqual(bash('git status').decision, 'pass');
  assert.strictEqual(bash('ls token-xi-ls').decision, 'pass');
  assert.strictEqual(bash('rm -rf /tmp/token-nu-rm').decision, 'deny');
  assert.strictEqual(bash('rm -rf /tmp/token-nu-rm').decision, 'pass');
  assert.strictEqual(bash('echo token-mu-echo > out.txt').decision, 'deny');
  assert.strictEqual(bash('echo token-mu-echo > out.txt').decision, 'pass');
  assert.strictEqual(powershell('Get-ChildItem token-omicron-ps').decision, 'pass');
  assert.strictEqual(bash('echo token-mu-echo', { GATEGUARD_BASH_ROUTINE_DISABLED: '1' }).decision, 'pass');
  const events = readEvents();
  assert.deepStrictEqual(
    events.map(e => [e.tool, e.decision, e.reason]),
    [
      ['Bash', 'pass', 'readonly-git'],
      ['Bash', 'routine-readonly', 'readonly'],
      ['Bash', 'destructive-deny', 'destructive'],
      ['Bash', 'pass-checked', 'destructive-retry'],
      ['Bash', 'routine-deny', 'first-command'],
      ['Bash', 'pass-checked', 'routine-checked'],
      ['PowerShell', 'pass-checked', 'routine-checked'],
      ['Bash', 'pass-exempt', 'routine-disabled']
    ]
  );
  for (const event of events) {
    assert.strictEqual(event.class, null);
    assert.strictEqual(event.sensitive, false);
    assert.strictEqual(event.questions, null);
    assert.strictEqual(event.profile, null);
  }
});

test('records a read-only first PowerShell command', () => {
  resetState();
  assert.strictEqual(powershell('Get-ChildItem token-omicron-ps').decision, 'pass');
  assert.deepStrictEqual([lastEvent().tool, lastEvent().decision], ['PowerShell', 'routine-readonly']);
});

test('never writes paths, commands, content or session ids to the metrics file', () => {
  resetState();
  edit(src('secret-widget-alpha.js'), 'CODE-BODY-PI', 'CODE-BODY-PI 2');
  edit(path.join(projectRoot, '.env.local'), 'A=1', 'A=2');
  edit(src('quiet-helper-beta.js'), 'run(); // COMMENT-BODY-RHO old', 'run(); // COMMENT-BODY-RHO new');
  const turn = writeTranscript([['Grep', { pattern: 'nearmiss-delta', path: path.join(projectRoot, 'docs') }]]);
  edit(src('nearmiss-delta.js'), 'a', 'b', turn);
  write(path.join(projectRoot, 'src', 'widgets', 'scaffold-epsilon.js'), 'CODE-BODY-PI');
  write(path.join(projectRoot, 'src', 'widgets', 'scaffold-zeta.js'), 'CODE-BODY-PI');
  bash('rm -rf /tmp/token-nu-rm');
  bash('echo token-mu-echo > out.txt');
  powershell('Get-ChildItem token-omicron-ps');
  const combined = fs.readFileSync(metricsFile, 'utf8');
  assert.ok(combined.split('\n').filter(Boolean).length >= 9);
  for (const fixture of [...FIXTURE_STRINGS, SESSION_ID, tmpBase, '/tmp', '.env', 'rm -rf', 'Grep']) {
    assert.ok(!combined.includes(fixture), `metrics must not contain ${fixture}`);
  }
});

test('rotates the file past 1 MiB and replaces the previous rotation', () => {
  resetState();
  fs.writeFileSync(`${metricsFile}.1`, 'stale\n', 'utf8');
  const filler = `${JSON.stringify({ v: 1, filler: 'x'.repeat(200) })}\n`;
  fs.writeFileSync(metricsFile, filler.repeat(Math.ceil((1024 * 1024) / filler.length)), 'utf8');
  const before = fs.statSync(metricsFile).size;
  assert.ok(before >= 1024 * 1024);
  edit(src('secret-widget-alpha.js'));
  assert.strictEqual(fs.statSync(`${metricsFile}.1`).size, before);
  assert.strictEqual(readEvents().length, 1);
  assert.strictEqual(lastEvent().decision, 'deny');
});

test('keeps the gate decision when the metrics file cannot be written', () => {
  resetState();
  fs.mkdirSync(metricsFile);
  const result = edit(src('secret-widget-alpha.js'));
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.decision, 'deny');
  assert.strictEqual(bash('echo token-mu-echo').decision, 'deny');
});

fs.rmSync(tmpBase, { recursive: true, force: true });

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
