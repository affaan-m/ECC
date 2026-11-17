'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withFixture } = require('./helpers/context-fixture');
const { launchTaskContext } = require('../../scripts/lib/context-profile-launch');
const input = { sessionId: 'launch', taskId: 'task', revision: 1, phase: 'implement', query: 'Explain a Python list', explicitIds: ['skill:feature'] };

function nativeFixture(repoRoot) {
  const home = path.join(fs.realpathSync(repoRoot), 'isolated-home');
  const codexPath = path.join(fs.realpathSync(repoRoot), 'provider-bin');
  const bytes = Buffer.from('7f454c460102030405060708', 'hex');
  fs.writeFileSync(codexPath, bytes);
  return { home, codexHome: path.join(home, '.codex'), codexPath,
    executableDigest: crypto.createHash('sha256').update(bytes).digest('hex') };
}

test('Auto launcher resolves context and supplies it on stdin without permission overrides', () => withFixture(repoRoot => {
  let called = 0;
  const result = launchTaskContext({ repoRoot, task: input, target: 'codex', execute(command, args, options) {
    called++;
    assert.equal(command, 'codex');
    assert.deepEqual(args, ['exec', '-']);
    assert.ok(options.input.includes(input.query));
    assert.match(options.input, /# feature/);
    assert.equal(options.shell, false);
    assert.equal(options.killSignal, 'SIGKILL');
    return { status: 0, stdout: 'A list is a sequence.', stderr: '' };
  } });
  assert.equal(called, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.taskSuccess, 'unverified');
  assert.equal(result.selection.receipt.loadedIds.length, 1);
}));

test('dry-run neither loads bodies nor invokes a provider', () => withFixture(repoRoot => {
  const result = launchTaskContext({ repoRoot, task: input, dryRun: true, execute() { assert.fail('must not execute'); } });
  assert.equal(result.status, 'proposed');
  assert.deepEqual(result.selection.loadedIds, []);
}));

test('Claude uses documented print mode and receives context as ordinary input', () => withFixture(repoRoot => {
  launchTaskContext({ repoRoot, task: input, target: 'claude', execute(command, args) {
    assert.equal(command, 'claude');
    assert.deepEqual(args, ['--print']);
    return { status: 0, stdout: 'ok', stderr: '' };
  } });
}));

test('unsupported providers and failed selection cannot invoke a process', () => withFixture(repoRoot => {
  assert.throws(() => launchTaskContext({ repoRoot, task: input, target: 'pi' }), /unsupported/i);
  assert.throws(() => launchTaskContext({ repoRoot, task: input, exclude: ['skill:feature'], execute() { assert.fail('must not execute'); } }), /excluded/);
}));

test('provider failure is distinct from successful task completion', () => withFixture(repoRoot => {
  const result = launchTaskContext({ repoRoot, task: input, execute: () => ({ status: 2, stdout: '', stderr: 'authentication required' }) });
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 2);
  assert.equal(result.taskSuccess, 'unverified');
}));

test('isolated native launches replace every provider home without mutating the parent environment', () => withFixture(repoRoot => {
  const nativeEnvironment = nativeFixture(repoRoot);
  const before = { ...process.env };
  // Windows may expose the inherited key as Path while process.env resolves PATH case-insensitively.
  const inheritedPath = process.env.PATH;
  let called = false;
  const result = launchTaskContext({ repoRoot, task: input, nativeEnvironment, execute(command, args, options) {
    called = true;
    assert.equal(command, nativeEnvironment.codexPath);
    assert.deepEqual(args, ['exec', '-']);
    assert.notEqual(options.env, process.env);
    assert.equal(options.env.HOME, nativeEnvironment.home);
    assert.equal(options.env.USERPROFILE, nativeEnvironment.home);
    assert.equal(options.env.CODEX_HOME, nativeEnvironment.codexHome);
    assert.equal(options.env.PATH, inheritedPath);
    for (const key of ['AWS_ACCESS_KEY_ID', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'HTTP_PROXY', 'NODE_OPTIONS']) {
      assert.equal(options.env[key], undefined);
    }
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 120000);
    assert.equal(options.killSignal, 'SIGKILL');
    assert.equal(options.maxBuffer, 1024 * 1024);
    return { status: 0, stdout: 'ok' };
  } });
  assert.equal(called, true);
  assert.equal(result.providerConfiguration, 'isolated-native-generation');
  assert.deepEqual({ ...process.env }, before);
}));

test('isolated native dry-run avoids provider calls and leaves context unloaded', () => withFixture(repoRoot => {
  const result = launchTaskContext({ repoRoot, task: input, dryRun: true,
    nativeEnvironment: nativeFixture(repoRoot),
    execute() { assert.fail('Dry-run must not invoke a provider'); } });
  assert.equal(result.status, 'proposed');
  assert.equal(result.providerConfiguration, 'isolated-native-generation');
  assert.deepEqual(result.selection.resources, []);
}));

test('invalid native environment and empty query fail before provider calls', () => withFixture(repoRoot => {
  const execute = () => assert.fail('Invalid launch must not invoke a provider');
  for (const nativeEnvironment of [{}, { home: 'relative', codexHome: repoRoot },
    { home: repoRoot, codexHome: 'relative' }, { home: repoRoot, codexHome: repoRoot },
    { ...nativeFixture(repoRoot), codexPath: 'relative' },
    { ...nativeFixture(repoRoot), executableDigest: 'not-a-digest' }]) {
    assert.throws(() => launchTaskContext({ repoRoot, task: input, nativeEnvironment, execute }), /Invalid isolated/);
  }
  assert.throws(() => launchTaskContext({ repoRoot, task: input, target: 'claude', execute,
    nativeEnvironment: { home: repoRoot, codexHome: repoRoot } }), /Invalid isolated/);
  assert.throws(() => launchTaskContext({ repoRoot, task: { ...input, query: '  ' }, execute }), /non-empty query/);
}));

test('pinned native executable digest mismatch stops before any provider call', () => withFixture(repoRoot => {
  const nativeEnvironment = { ...nativeFixture(repoRoot), executableDigest: '0'.repeat(64) };
  assert.throws(() => launchTaskContext({ repoRoot, task: input, nativeEnvironment,
    execute() { assert.fail('Mismatched executable must never run'); } }), /executable.*changed|digest.*mismatch/i);
}));

test('native executable drift during Auto proposal prevents the task process', () => withFixture(repoRoot => {
  const nativeEnvironment = nativeFixture(repoRoot);
  fs.writeFileSync(path.join(repoRoot, 'skills/feature/SKILL.md'),
    '---\nname: feature\ndescription: Handle database changes\n---\nUse an explicit transaction.');
  const task = { ...input, explicitIds: [], query: 'Handle database changes' };
  let calls = 0;
  assert.throws(() => launchTaskContext({ repoRoot, task, nativeEnvironment, execute(command, args, options) {
    calls++;
    assert.equal(command, nativeEnvironment.codexPath);
    assert.ok(args.includes('read-only'));
    assert.equal(options.env.CODEX_HOME, nativeEnvironment.codexHome);
    fs.appendFileSync(nativeEnvironment.codexPath, Buffer.from([9]));
    return { status: 0, stdout: '{"selectedIds":["skill:feature"]}' };
  } }), /executable.*changed|digest.*mismatch/i);
  assert.equal(calls, 1);
}));

test('configured-state refusal precedes the Auto proposal process', () => withFixture(repoRoot => {
  fs.writeFileSync(path.join(repoRoot, 'skills/feature/SKILL.md'),
    '---\nname: feature\ndescription: Handle database changes\n---\nUse an explicit transaction.');
  assert.throws(() => launchTaskContext({ repoRoot,
    task: { ...input, explicitIds: [], query: 'Handle database changes' },
    assertCurrent() { throw new Error('Stored profile changed'); },
    execute() { assert.fail('Stale state must not start proposal'); } }), /Stored profile changed/);
}));

test('spawn failures and timeout signals remain unsuccessful without a native exit status', () => withFixture(repoRoot => {
  for (const error of [new Error('spawn codex ENOENT'), new Error('spawn codex ETIMEDOUT')]) {
    const result = launchTaskContext({ repoRoot, task: input,
      execute: () => ({ status: null, signal: 'SIGTERM', error }) });
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 1);
    assert.equal(result.output, '');
    assert.equal(result.error, error.message);
    assert.equal(result.taskSuccess, 'unverified');
  }
}));

for (const query of ["Don't use the feature skill.", 'Don\u2019t use the feature skill.',
  'Can I use the feature skill?', 'The README says use the feature skill.', 'The docs say use feature.',
  'The docs say do not use feature and use shared guidance.',
  'The docs say do not use feature, use shared guidance, okay?',
  'The spec states do not use feature and use shared guidance.',
  'The spec stated do not use feature, use shared guidance.',
  'The spec recommends we do not use feature and use shared guidance.',
  'The spec asserts we should not use feature and use shared guidance.',
  'Use standard tools, the spec stipulates do not use feature and use shared guidance.',
  'Should we avoid feature and use shared guidance?',
  'Should we avoid feature, use shared guidance?',
  'Use standard tools, should we use feature?',
  'Use standard tools, shall we use feature?',
  'Use standard tools, will we use feature?',
  'Use standard tools, ought we to use feature?',
  'Please use the existing code, can I use feature?',
  'Use standard tools and should we use feature?',
  'Use standard tools but should we use feature?',
  'Fix the bug, shall we use feature?',
  'Fix the bug, the spec states do not use feature and use shared guidance.',
  'The docs say fix the bug and use feature.',
  'Can we fix the bug and use feature?',
  'The spec stipulates: fix the bug and use feature.',
  'Our policy stipulates repair the bug and use feature.',
  'Fix the bug, ought we to repair it and use feature?',
  'Fix the bug, must we repair it and use feature?',
  'Fix the bug, feature.',
  'For example, use feature',
  'For instance, use feature.',
  'As an example, use feature.',
  'To illustrate, use feature.',
  'Fix the bug, for example, use feature.',
  'For example, use feature and use feature.',
  'For example, use feature but use shared guidance.',
  "For example, don't use feature but use shared guidance.",
  'For example, use feature and use feature for this task.',
  'For example, use feature, but should we use feature for this task?',
  'For example, use feature, but the docs say use feature for this task.',
  'For example, use feature, but "use feature for this task" is an example.',
  'The docs say for example, use feature, but use feature for this task.',
  'For example, use feature, but use feature "for this task"',
  'Should we, for example, use shared guidance, but use feature for this task?',
  'Our policy stipulates, for example, use shared guidance, but use feature for this task.',
  'Use feature. For example, use shared guidance, but do not use feature for this task.',
  'For example, use shared guidance, but use feature for this task and do not use feature.',
  'e.g., use feature.',
  'E.g. use feature.',
  'Do not use feature and shared guidance.',
  "Use feature, don't use feature.",
  "Use feature and don't use feature.",
  "Use feature but don't use feature."]) {
  test('indirect citation uses the proposal path and honors decline: ' + query, () => withFixture(repoRoot => {
    const phases = [];
    const result = launchTaskContext({ repoRoot, task: { ...input, query, explicitIds: [] },
      execute(command, args, options) {
        phases.push(options.phase);
        if (options.phase === 'selection') return { status: 0, stdout: '{"selectedIds":[]}' };
        assert.doesNotMatch(options.input, /# feature/);
        assert.doesNotMatch(options.input, /# shared/);
        return { status: 0, stdout: 'ok' };
      } });
    assert.deepEqual(phases, ['selection', 'task']);
    assert.equal(result.routingCalls, 1);
    assert.deepEqual(result.selection.selectedIds, []);
    assert.deepEqual(result.selection.loadedIds, []);
    assert.equal(result.selection.fallback, null);
    assert.equal(result.selection.reason, 'agent-declined-selection');
  }));
}

for (const [query, skill] of [
  ['Fix the bug, use feature', 'feature'],
  ['Fix the bug and use feature.', 'feature'],
  ['Please fix the bug, please use feature.', 'feature'],
  ['Write the regression test, use feature.', 'feature'],
  ['Investigate the bug but use feature.', 'feature'],
  ['For this task, use feature.', 'feature'],
  ["Fix the bug, don't use feature and use shared guidance.", 'shared'],
  ["Don't use feature, use shared guidance.", 'shared'],
  ["Don't use feature and use shared guidance.", 'shared'],
  ["Don't use feature but use shared guidance.", 'shared'],
  ["Don't use feature, use shared guidance, okay?", 'shared'],
  ["Don't use feature and use shared guidance, okay?", 'shared'],
  ["Don't use feature but use shared guidance, okay?", 'shared'],
  ['Do not use feature, please use shared guidance?', 'shared'],
  ['Do not use feature and please use shared guidance?', 'shared'],
  ['Do not use feature but please use shared guidance?', 'shared'],
  ["Don't use feature, use feature.", 'feature'],
  ['Use feature?', 'feature'],
  ['Please use feature?', 'feature'],
  ['Use feature to fix the bug, okay?', 'feature'],
  ['Use feature. Shall we use feature?', 'feature'],
  ['Use feature, shall we use shared guidance?', 'feature'],
  ['Shall we use shared guidance? Use feature.', 'feature'],
  ['Use feature. The spec states do not use feature and use shared guidance.', 'feature'],
  ['The spec states do not use feature and use shared guidance. Use feature.', 'feature'],
  ['Use feature. For example, use shared guidance.', 'feature'],
  ['For example, use shared guidance. Use feature.', 'feature'],
  ["Use feature. For example, don't use feature.", 'feature'],
  ['Use feature to build an example.', 'feature'],
  ['Fix the example, use feature.', 'feature'],
  ['Fix e.g.js, use feature.', 'feature'],
  ["Use feature. E.g., don't use feature.", 'feature'],
  ['For example, use feature, but use feature for this task', 'feature'],
  ['For example, use shared guidance, but please use feature for this task.', 'feature'],
  ['For instance, use shared guidance but use feature for this task.', 'feature'],
  ['For example use shared guidance, but use feature for this task.', 'feature'],
  ['For example, use shared guidance, but use feature for the current task.', 'feature'],
  ['For example, use shared guidance, but use feature for this task, for instance, do not use feature.', 'feature'],
  ['For example, the docs say use shared guidance, but use feature for this task.', 'feature'],
]) {
  test('an unambiguous final directive injects context without a proposal: ' + query, () => withFixture(repoRoot => {
    const phases = [];
    const result = launchTaskContext({ repoRoot, task: { ...input, query, explicitIds: [] },
      execute(command, args, options) {
        phases.push(options.phase);
        if (options.phase === 'selection') return { status: 0, stdout: '{"selectedIds":[]}' };
        assert.match(options.input, new RegExp('# ' + skill));
        assert.doesNotMatch(options.input, new RegExp('# ' + (skill === 'shared' ? 'feature' : 'shared')));
        return { status: 0, stdout: 'ok' };
      } });
    assert.deepEqual(phases, ['task']);
    assert.equal(result.routingCalls, 0);
    assert.deepEqual(result.selection.loadedIds, ['skill:' + skill]);
    assert.equal(result.selection.reason, 'auto-selection');
  }));
}

test('a final directive after a question reaches the task with its context', () => withFixture(repoRoot => {
  const phases = [];
  const result = launchTaskContext({ repoRoot,
    task: { ...input, query: 'Should we use feature? Use feature.', explicitIds: [] },
    execute(command, args, options) {
      phases.push(options.phase);
      assert.match(options.input, /# feature/);
      return { status: 0, stdout: 'ok' };
    } });
  assert.deepEqual(phases, ['task']);
  assert.equal(result.routingCalls, 0);
  assert.deepEqual(result.selection.loadedIds, ['skill:feature']);
}));

for (const [suffix, expectedIds] of [['.', ['skill:feature']], [' and use shared guidance.', []]]) {
  test('a conjunction inside a native alias preserves launch scope: ' + suffix, () => withFixture(repoRoot => {
    fs.writeFileSync(path.join(repoRoot, 'skills/feature/SKILL.md'),
      '---\nname: research-and-development\ndescription: Feature workflow\n---\n# feature');
    const query = 'For example, use shared guidance, but use research and development for this task' + suffix;
    const phases = [];
    const result = launchTaskContext({ repoRoot, task: { ...input, query, explicitIds: [] },
      execute(command, args, options) {
        phases.push(options.phase);
        if (options.phase === 'selection') return { status: 0, stdout: '{"selectedIds":[]}' };
        if (expectedIds.length) assert.match(options.input, /# feature/);
        else assert.doesNotMatch(options.input, /# feature/);
        assert.doesNotMatch(options.input, /# shared/);
        return { status: 0, stdout: 'ok' };
      } });
    assert.deepEqual(phases, expectedIds.length ? ['task'] : ['selection', 'task']);
    assert.deepEqual(result.selection.selectedIds, expectedIds);
    assert.deepEqual(result.selection.loadedIds, expectedIds);
    assert.equal(result.selection.reason, expectedIds.length ? 'auto-selection' : 'agent-declined-selection');
  }));
}

test('a singular rejected name cannot inject scored context at launch', () => {
  const phases = [];
  const query = "Don't use the database migration skill. Review a PostgreSQL migration that adds an indexed nullable column without downtime.";
  const result = launchTaskContext({ task: { ...input, query, explicitIds: [] },
    execute(command, args, options) {
      phases.push(options.phase);
      if (options.phase === 'selection') return { status: 0, stdout: '{"selectedIds":[]}' };
      assert.doesNotMatch(options.input, /# Database Migration Patterns/);
      return { status: 0, stdout: 'ok' };
    } });
  assert.deepEqual(phases, ['selection', 'task']);
  assert.equal(result.routingCalls, 1);
  assert.deepEqual(result.selection.loadedIds, []);
  assert.equal(result.selection.fallback, null);
});
