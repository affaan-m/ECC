'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const runtime = path.resolve(__dirname, '../../scripts/hooks/copilot-lifecycle.js');
let passed = 0;
let failed = 0;

function test(name, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc lifecycle è-'));
  const cwd = path.join(root, 'project');
  const config = path.join(root, 'copilot');
  fs.mkdirSync(cwd);
  fs.mkdirSync(config);
  const env = { ...process.env, COPILOT_HOME: config, ECC_HOOKS_ENABLED: 'true',
    ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: '', ECC_COPILOT_TRANSCRIPT_SUMMARY: '' };
  const invoke = (args, input = '', overrides = {}) => {
    const result = spawnSync(process.execPath, [runtime, ...args], {
      cwd, env: { ...env, ...overrides }, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 15000,
    });
    assert.ifError(result.error);
    return { ...result, output: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  };
  const event = (name, extra = {}, overrides = {}) => invoke([name], { sessionId: 's1', cwd, timestamp: Date.now(), ...extra }, overrides);
  try { action({ root, cwd, config, env, invoke, event }); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function transcript(config, entries, session = 's1') {
  const file = path.join(config, 'session-state', session, 'events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n') + '\n');
  return file;
}

test('new session, explicit checkpoint, stop/end and new session restore historical context', ({ event, invoke }) => {
  assert.strictEqual(event('sessionStart', { source: 'startup' }).status, 0);
  assert.strictEqual(invoke(['checkpoint', '--session', 's1', '--stdin'], 'Tests passed; deployment pending.').status, 0);
  assert.deepStrictEqual(event('agentStop').output, {});
  assert.deepStrictEqual(event('preCompact').output, {});
  assert.deepStrictEqual(event('sessionEnd', { reason: 'user_exit' }).output, {});
  const restored = event('sessionStart', { sessionId: 's2', source: 'new' });
  assert.strictEqual(restored.status, 0, restored.stderr);
  assert.match(restored.output.additionalContext, /HISTORICAL REFERENCE ONLY/);
  assert.match(restored.output.additionalContext, /Tests passed/);
  assert.match(restored.output.additionalContext, /not.*instructions/i);
  assert.strictEqual(invoke(['list']).output.sessions.length, 2);
  assert.match(invoke(['recall', '--session', 's1']).output.summary, /deployment pending/);
});

test('resume restores only current session, never another workspace or unrelated session', ({ root, cwd, invoke, event }) => {
  invoke(['checkpoint', '--session', 's1', '--stdin'], 'Workspace one.');
  assert.deepStrictEqual(event('sessionStart', { sessionId: 's2', source: 'resume' }).output, {});
  const other = path.join(root, 'other'); fs.mkdirSync(other);
  assert.deepStrictEqual(event('sessionStart', { cwd: other, sessionId: 's3', source: 'new' }).output, {});
  assert.strictEqual(invoke(['recall']).output.workspace, fs.realpathSync(cwd));
});

test('malformed, oversized UTF8, conflicting aliases and unsafe identity have no side effects', ({ config, invoke, event }) => {
  for (const value of ['{', 'è'.repeat(600000)]) assert.notStrictEqual(invoke(['sessionStart'], value).status, 0);
  for (const sessionId of ['../outside', 'a/b', 'a\\b', 'a:ads', '', 'x'.repeat(129)]) {
    assert.notStrictEqual(event('sessionStart', { sessionId }).status, 0);
  }
  assert.notStrictEqual(event('sessionStart', { session_id: 'different' }).status, 0);
  assert.notStrictEqual(event('sessionStart', { cwd: 'relative' }).status, 0);
  assert.notStrictEqual(event('sessionStart', { source: 'other' }).status, 0);
  assert.ok(!fs.existsSync(path.join(config, 'ecc')));
});

test('disabled lifecycle and minimal profile leave no files; Claude options cannot disable Copilot', ({ config, event }) => {
  for (const overrides of [{ ECC_HOOKS_ENABLED: 'false' }, { ECC_HOOK_PROFILE: 'minimal' }, { ECC_DISABLED_HOOKS: 'copilot:sessionStart' }]) {
    assert.deepStrictEqual(event('sessionStart', {}, overrides).output, {});
    assert.ok(!fs.existsSync(path.join(config, 'ecc')));
  }
  assert.strictEqual(event('sessionStart', {}, { CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false' }).status, 0);
  assert.ok(fs.existsSync(path.join(config, 'ecc')));
});

test('transcript access is opt-in; known native events summarized without reasoning/results or raw transcript', ({ config, event, invoke }) => {
  const file = transcript(config, [
    { type: 'user.message', data: { content: 'Fix authentication.' } },
    { type: 'assistant.message', data: { content: 'CLAIM_NOT_EVIDENCE', reasoningText: 'PRIVATE_REASONING' } },
    { type: 'user.message', agentId: 'sub', data: { content: 'SUBAGENT' } },
    { type: 'tool.execution_start', data: { toolName: 'edit', arguments: { path: 'src/auth.js', command: 'SECRET_COMMAND' } } },
    { type: 'tool.execution_complete', data: { result: { content: 'RAW_OUTPUT' } } },
    { type: 'unknown.future', data: { content: 'UNKNOWN' } },
  ]);
  event('agentStop', { transcriptPath: file });
  assert.strictEqual(invoke(['recall']).output.summary, '');
  const captured = event('preCompact', { transcriptPath: file }, { ECC_COPILOT_TRANSCRIPT_SUMMARY: '1' });
  assert.strictEqual(captured.status, 0, captured.stderr);
  const summary = invoke(['recall']).output.summary;
  assert.match(summary, /Fix authentication/); assert.match(summary, /src\/auth.js/);
  for (const value of ['PRIVATE_REASONING', 'CLAIM_NOT_EVIDENCE', 'SUBAGENT', 'SECRET_COMMAND', 'RAW_OUTPUT', 'UNKNOWN']) assert.ok(!summary.includes(value), value);
});

test('transcript path cannot read another session, external file, symlink or oversized source', ({ root, config, event, invoke }) => {
  invoke(['checkpoint', '--session', 's1', '--stdin'], 'Keep this checkpoint.');
  const foreign = transcript(config, [{ type: 'user.message', data: { content: 'PRIVATE' } }], 's2');
  const file = transcript(config, []);
  const external = path.join(root, 'external'); fs.writeFileSync(external, 'PRIVATE');
  for (const transcriptPath of [foreign, external]) assert.notStrictEqual(event('agentStop', { transcriptPath }, { ECC_COPILOT_TRANSCRIPT_SUMMARY: '1' }).status, 0);
  fs.unlinkSync(file); fs.symlinkSync(external, file);
  assert.notStrictEqual(event('agentStop', { transcriptPath: file }, { ECC_COPILOT_TRANSCRIPT_SUMMARY: '1' }).status, 0);
  fs.unlinkSync(file); fs.writeFileSync(file, 'x'.repeat(4 * 1024 * 1024 + 1));
  assert.notStrictEqual(event('agentStop', { transcriptPath: file }, { ECC_COPILOT_TRANSCRIPT_SUMMARY: '1' }).status, 0);
  assert.strictEqual(invoke(['recall']).output.summary, 'Keep this checkpoint.');
});

test('secret scan runs before truncation and malformed transcript preserves prior checkpoint', ({ config, event, invoke }) => {
  invoke(['checkpoint', '--session', 's1', '--stdin'], 'Safe checkpoint.');
  const secret = 'ghp_' + 'a'.repeat(36);
  const rejected = invoke(['checkpoint', '--session', 's1', '--stdin'], 'x'.repeat(1000) + ' ' + secret);
  assert.notStrictEqual(rejected.status, 0); assert.ok(!rejected.stderr.includes(secret));
  const file = transcript(config, [{ type: 'user.message', data: { content: 'x'.repeat(1000) + ' ' + secret } }]);
  assert.strictEqual(event('agentStop', { transcriptPath: file }, { ECC_COPILOT_TRANSCRIPT_SUMMARY: '1' }).status, 0);
  assert.strictEqual(invoke(['recall']).output.summary, 'Safe checkpoint.');
  fs.writeFileSync(file, '{bad}\n');
  assert.notStrictEqual(event('preCompact', { transcriptPath: file }, { ECC_COPILOT_TRANSCRIPT_SUMMARY: '1' }).status, 0);
});

test('symlink storage root rejected; manual checkpoint needs no automatic hooks', ({ root, config, invoke }) => {
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(config, 'ecc'));
  assert.notStrictEqual(invoke(['checkpoint', '--session', 's1', '--stdin'], 'Do not escape.').status, 0);
  assert.deepStrictEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(config, 'ecc'));
  assert.strictEqual(invoke(['checkpoint', '--session', 's1', '--stdin'], 'Manual save.', { ECC_HOOKS_ENABLED: 'false' }).status, 0);
});

test('automatic observations cannot overwrite a manual checkpoint and context controls apply', ({ config, event, invoke }) => {
  invoke(['checkpoint', '--session', 's1', '--stdin'], 'Verified tests passed; ticket 42 blocks rollout.');
  const file = transcript(config, [{ type: 'user.message', data: { content: 'Implement migration.' } }]);
  event('agentStop', { transcriptPath: file }, { ECC_COPILOT_TRANSCRIPT_SUMMARY: '1' });
  assert.match(invoke(['recall']).output.summary, /ticket 42/);
  for (const overrides of [{ ECC_SESSION_START_CONTEXT: 'false' }, { ECC_SESSION_START_MAX_CHARS: '0' }]) {
    assert.deepStrictEqual(event('sessionStart', { source: 'resume' }, overrides).output, {});
  }
});

test('snake-case lifecycle schema works; duplicate events preserve a bounded manual checkpoint', ({ event, invoke }) => {
  assert.strictEqual(invoke(['sessionStart'], { session_id: 's1', cwd: process.cwd(), timestamp: new Date().toISOString(), source: 'startup' }).status, 0);
  assert.strictEqual(invoke(['checkpoint', '--session', 's1', '--stdin'], 'a'.repeat(16000)).status, 0);
  event('sessionEnd'); event('sessionEnd');
  const result = event('sessionStart', { source: 'resume' });
  assert.ok(Buffer.byteLength(result.stdout) < 24000);
  assert.strictEqual(invoke(['list']).output.sessions.length, 1);
});

test('corrupt state fails explicitly, hardlinks are refused and context budget is enforced', ({ root, config, event, invoke }) => {
  invoke(['checkpoint', '--session', 's1', '--stdin'], 'a'.repeat(10000));
  const restored = event('sessionStart', { source: 'resume' }, { ECC_SESSION_START_MAX_CHARS: '600' });
  assert.ok(restored.output.additionalContext.length <= 600);
  assert.match(restored.output.additionalContext, /truncated/);
  assert.deepStrictEqual(event('sessionStart', { source: 'resume' }, { ECC_SESSION_START_MAX_CHARS: '50' }).output, {});
  assert.notStrictEqual(event('sessionStart', { source: 'resume' }, { ECC_SESSION_START_MAX_CHARS: 'bad' }).status, 0);
  const dir = path.join(config, 'ecc', 'projects', fs.readdirSync(path.join(config, 'ecc', 'projects'))[0]);
  const file = path.join(dir, fs.readdirSync(dir).find(name => name.endsWith('.json')));
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...record, updatedAt: '2026-11-03' + ' '.repeat(12000) }));
  assert.notStrictEqual(invoke(['recall']).status, 0);
  fs.writeFileSync(file, JSON.stringify(record));
  fs.linkSync(file, path.join(root, 'hardlink'));
  assert.notStrictEqual(invoke(['recall']).status, 0);
});

test('invalid CLI use, checkpoint bounds and invalid config fail without exposing input', ({ invoke }) => {
  for (const args of [[], ['unknown'], ['checkpoint'], ['recall', '--unknown'], ['list', 'extra']]) assert.notStrictEqual(invoke(args).status, 0);
  for (const summary of ['', 'x'.repeat(17000), '\u001b[31mred', 'password=private']) assert.notStrictEqual(invoke(['checkpoint', '--session', 's1', '--stdin'], summary).status, 0);
  assert.notStrictEqual(invoke(['list'], '', { COPILOT_HOME: 'relative' }).status, 0);
});

test('unreadable transcript record shape/encoding and changed storage paths return errors', ({ config, event, invoke }) => {
  const file = transcript(config, ['null']);
  for (const content of ['null\n', 'x'.repeat(128 * 1024 + 1), Buffer.from([255, 254])]) {
    fs.writeFileSync(file, content);
    assert.notStrictEqual(event('preCompact', { transcriptPath: file }, { ECC_COPILOT_TRANSCRIPT_SUMMARY: '1' }).status, 0);
  }
  invoke(['checkpoint', '--session', 's1', '--stdin'], 'Retain me.');
  const dir = path.join(config, 'ecc', 'projects', fs.readdirSync(path.join(config, 'ecc', 'projects'))[0]);
  fs.writeFileSync(path.join(dir, 'unexpected.json'), '{}');
  assert.notStrictEqual(invoke(['list']).status, 0);
});

test('exclusive writer lock preserves checkpoint and new POSIX files are private', ({ config, invoke }) => {
  invoke(['checkpoint', '--session', 's1', '--stdin'], 'Original checkpoint.');
  const projects = path.join(config, 'ecc', 'projects');
  const dir = path.join(projects, fs.readdirSync(projects)[0]);
  const file = path.join(dir, fs.readdirSync(dir).find(name => name.endsWith('.json')));
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  }
  const lock = file.replace(/\.json$/, '.lock');
  fs.mkdirSync(lock);
  assert.notStrictEqual(invoke(['checkpoint', '--session', 's1', '--stdin'], 'Concurrent writer.').status, 0);
  assert.strictEqual(invoke(['recall']).output.summary, 'Original checkpoint.');
  fs.rmdirSync(lock);
  assert.ok(fs.readdirSync(dir).every(name => name.endsWith('.json')), 'no leaked temporary data');
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
