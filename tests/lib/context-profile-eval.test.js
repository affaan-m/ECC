'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { preregister, runEvaluation, parseCodexJsonl, parseClaudeJson, summarize, wilson, runCheck,
  createAuthLease, createCodexProvider, createClaudeProvider, prepareClaudeEnvironments,
  providerFamily, resolveFamily } = require('../../docker/context-profiles/ai-eval-lib');
const { withFixture, write } = require('./helpers/context-fixture');
const root = path.resolve(__dirname, '../..');
const jsonl = (text = '{}', tokens = 10) => [
  { type: 'item.completed', item: { type: 'agent_message', text } },
  { type: 'turn.completed', usage: { input_tokens: tokens, cached_input_tokens: 2, output_tokens: 3 } },
].map(JSON.stringify).join('\n');
const claudeJson = (text = '{}', tokens = 10) => JSON.stringify({ type: 'result', result: text, is_error: false,
  usage: { input_tokens: tokens, cache_creation_input_tokens: 3, cache_read_input_tokens: 4, output_tokens: 5 } });
const posix = process.platform !== 'win32';
const permissionModel = Number(process.versions.node.split('.')[0]) >= 20;

// A tiny v2 corpus over the fixture registry. The fix lives only in this test, never in provider inputs.
const FIX = 'module.exports = (a, b) => a + b;\n';
function tinyCorpus(overrides = {}) {
  return { schemaVersion: 'ecc.context-eval-corpus.v2', id: 'tiny@1', sampling: 'test', minimumDistinctTasks: 30,
    nonInferiorityMargin: 0.05,
    selection: [{ id: 'plain', category: 'no-workflow', query: 'Add two numbers.', noWorkflow: true, expectedIds: [] }],
    tasks: [{ id: 'add', category: 'errors', manualIds: ['skill:feature'], query: 'Fix add.js so it returns the sum.',
      files: { 'add.js': 'module.exports = (a, b) => a - b;\n' },
      check: "const assert = require('node:assert/strict');\nassert.equal(require(require('node:path').join(process.cwd(), 'add.js'))(2, 3), 5);\n" }],
    ...overrides };
}
function providerFor(seen = [], { fix = true } = {}) {
  return request => {
    seen.push({ ...request, env: { ...request.env } });
    if (request.phase === 'selection') return { status: 0, stdout: jsonl('{"selectedIds":[]}') };
    if (fix) fs.writeFileSync(path.join(request.cwd, 'add.js'), FIX);
    return { status: 0, stdout: jsonl('secret transcript must never be stored') };
  };
}
function privateHome(bytes = '{"tokens":{"refresh_token":"old"}}') {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-eval-auth-')));
  fs.chmodSync(home, 0o700);
  fs.writeFileSync(path.join(home, 'auth.json'), bytes, { mode: 0o600 });
  return home;
}

test('JSONL collects usage only from completion events and fails closed on missing/malformed usage', () => {
  const parsed = parseCodexJsonl(jsonl('private text'));
  assert.deepEqual(parsed.usage, { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3 });
  assert.equal(parsed.text, 'private text');
  for (const raw of ['private text', '{}', '{"type":"turn.completed","usage":{"input_tokens":-1}}',
    jsonl() + '\n{"type":"turn.failed"}', jsonl() + '\nnot json']) {
    assert.equal(parseCodexJsonl(raw).valid, false);
  }
});

test('registration pins corpus, source, native-install design and paired order before execution', () => withFixture(repoRoot => {
  const corpus = tinyCorpus();
  const registration = preregister({ repoRoot, corpus });
  assert.equal(registration.schemaVersion, 'ecc.context-eval-registration.v2');
  assert.equal(registration.design, 'paired-native-installs-hidden-graded-coding-tasks');
  assert.match(registration.corpusDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(registration.arms, ['full', 'manual-lean', 'auto-lean', 'baseline']);
  assert.throws(() => runEvaluation({ registration: { ...registration, corpusDigest: '0'.repeat(64) },
    repoRoot, corpus, provider: () => assert.fail('called') }), /pin|registration/i);
}));

test('injected paired run grades hidden checks, gives Full no ECC bodies, removes workspaces and sanitizes metrics', () => withFixture(repoRoot => {
  assert.throws(() => runEvaluation(), /opt.in|provider/i);
  const seen = [];
  const result = runEvaluation({ repoRoot, corpus: tinyCorpus(), provider: providerFor(seen) });
  assert.equal(result.outcomes.length, 4);
  assert.ok(result.outcomes.every(row => row.passed), JSON.stringify(result.outcomes));
  assert.equal(result.selection[0].passed, true);
  assert.equal(result.gate.status, 'insufficient-sample');
  assert.equal(result.authentication, 'injected');
  assert.equal(result.credentialsRetained, false);
  assert.equal(result.artifactRetention, 'none');
  assert.ok(seen.every(call => !fs.existsSync(call.cwd)));
  const saved = JSON.stringify(result);
  for (const forbidden of ['secret transcript', 'resources', 'stdout', 'HOME', os.tmpdir()]) assert.ok(!saved.includes(forbidden), forbidden);
  const task = arm => seen.find(call => call.phase === 'task' && call.cwd.includes(`--${arm}--`));
  assert.deepEqual(result.outcomes.find(row => row.arm === 'full').selectedIds, []);
  assert.deepEqual(result.outcomes.find(row => row.arm === 'baseline').selectedIds, []);
  assert.deepEqual(result.outcomes.find(row => row.arm === 'manual-lean').selectedIds, ['skill:feature']);
  assert.match(task('manual-lean').input, /skill:feature/);
  assert.doesNotMatch(task('full').input, /skill:feature/);
  assert.doesNotMatch(task('baseline').input, /ecc.selected-context|resources/);
  assert.notEqual(task('full').env.CODEX_HOME, task('manual-lean').env.CODEX_HOME);
  assert.equal(task('manual-lean').env.CODEX_HOME, task('auto-lean').env.CODEX_HOME);
  assert.notEqual(task('baseline').env.CODEX_HOME, task('full').env.CODEX_HOME);
  assert.notEqual(task('baseline').env.CODEX_HOME, task('manual-lean').env.CODEX_HOME);
}));

test('claimed success without the required change fails the hidden check', () => withFixture(repoRoot => {
  const result = runEvaluation({ repoRoot, corpus: tinyCorpus(), provider: providerFor([], { fix: false }) });
  assert.ok(result.outcomes.every(row => !row.passed && row.failure === 'hidden-check'));
}));

test('hidden check refuses an agent-planted grader and runs read-only where Node supports it', () => withFixture(cwd => {
  fs.writeFileSync(path.join(cwd, '.ecc-eval-check.cjs'), 'process.exit(0)');
  assert.equal(runCheck(cwd, 'process.exit(0)'), false);
  fs.unlinkSync(path.join(cwd, '.ecc-eval-check.cjs'));
  assert.equal(runCheck(cwd, "require('node:fs').writeFileSync('planted.txt', 'x');"), !permissionModel);
  assert.equal(fs.existsSync(path.join(cwd, 'planted.txt')), !permissionModel);
}));

test('call budget stops work without dropping scheduled failures', () => withFixture(repoRoot => {
  let calls = 0;
  const result = runEvaluation({ repoRoot, corpus: tinyCorpus(), maxCalls: 1,
    provider: () => { calls++; return { status: 0, stdout: jsonl() }; } });
  assert.equal(calls, 1);
  assert.equal(result.outcomes.length, 4);
  assert.ok(result.outcomes.some(row => row.failure === 'call-budget'));
}));

test('deadline, provider exceptions and malformed streams remain sanitized scheduled failures', () => withFixture(repoRoot => {
  for (const [provider, failure, options] of [
    [() => { throw new Error('SECRET_CREDENTIAL'); }, 'provider-failed', {}],
    [() => ({ status: 1, stdout: jsonl(), stderr: 'SECRET_CREDENTIAL' }), 'provider-failed', {}],
    [() => ({ status: 0, stdout: 'SECRET_CREDENTIAL' }), 'invalid-jsonl', {}],
    [() => assert.fail('expired call'), 'deadline', { deadlineMs: 1 }],
  ]) {
    const result = runEvaluation({ repoRoot, corpus: tinyCorpus(), provider, ...options });
    assert.ok(result.outcomes.every(row => row.failure === failure), failure);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_CREDENTIAL/);
    assert.equal(result.usage, null);
  }
}));

test('source drift before and during calls invalidates evidence', () => withFixture(repoRoot => {
  const corpus = tinyCorpus();
  const registration = preregister({ repoRoot, corpus });
  write(repoRoot, 'skills/feature/SKILL.md', '---\nname: feature\ndescription: Changed.\n---\nChanged.');
  assert.throws(() => runEvaluation({ repoRoot, corpus, registration, provider: () => assert.fail('called') }), /pin|registration/i);
  let calls = 0;
  const result = runEvaluation({ repoRoot, corpus, provider: () => {
    calls++;
    write(repoRoot, 'skills/feature/SKILL.md', `---\nname: feature\ndescription: Drift ${calls}.\n---\nDrift.`);
    return { status: 0, stdout: jsonl() };
  } });
  assert.equal(calls, 1);
  assert.ok(result.outcomes.every(row => row.failure === 'source-drift'));
}));

test('a changed native install stops later calls as environment drift', () => withFixture(repoRoot => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-eval-env-'));
  try {
    const { fingerprintExecutable } = require('../../scripts/lib/context-profile-native-executable');
    const env = name => ({ profileId: `${name}@1`, skills: 1, restore() {}, verify: () => { const e = new Error('x'); e.code = 'environment-drift'; throw e; },
      launch: { home: temp, codexHome: temp, codexPath: process.execPath, executableDigest: fingerprintExecutable(process.execPath).digest } });
    const result = runEvaluation({ repoRoot, corpus: tinyCorpus(), environments: { full: env('full'), lean: env('lean'), baseline: env('baseline') },
      provider: () => assert.fail('called') });
    assert.ok(result.outcomes.every(row => row.failure === 'environment-drift'));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}));

test('prepared install config is restored after every call, including failed calls', () => withFixture(repoRoot => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-eval-env-'));
  try {
    const { fingerprintExecutable } = require('../../scripts/lib/context-profile-native-executable');
    let restores = 0;
    const env = name => ({ profileId: `${name}@1`, skills: 1, verify() {}, restore() { restores++; },
      launch: { home: temp, codexHome: temp, codexPath: process.execPath, executableDigest: fingerprintExecutable(process.execPath).digest } });
    let calls = 0;
    const result = runEvaluation({ repoRoot, corpus: tinyCorpus(), environments: { full: env('full'), lean: env('lean'), baseline: env('baseline') },
      provider: request => { calls++; if (calls === 1) throw new Error('crash'); return providerFor()(request); } });
    assert.equal(restores, calls);
    assert.equal(result.outcomes.filter(row => row.failure === 'provider-failed').length, 1);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}));

test('subscription lease copies private auth into the call home, returns refreshed tokens and always removes it', { skip: !posix }, () => {
  const authHome = privateHome();
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-eval-codex-'));
  try {
    const lease = createAuthLease(authHome);
    lease.run(codexHome, () => {
      const leased = path.join(codexHome, 'auth.json');
      assert.equal(fs.readFileSync(leased, 'utf8'), '{"tokens":{"refresh_token":"old"}}');
      assert.equal(fs.statSync(leased).mode & 0o777, 0o600);
      fs.writeFileSync(leased, '{"tokens":{"refresh_token":"new"}}');
    });
    assert.equal(fs.existsSync(path.join(codexHome, 'auth.json')), false);
    assert.equal(fs.readFileSync(path.join(authHome, 'auth.json'), 'utf8'), '{"tokens":{"refresh_token":"new"}}');
    assert.throws(() => lease.run(codexHome, () => { throw new Error('provider crashed'); }), /crashed/);
    assert.equal(fs.existsSync(path.join(codexHome, 'auth.json')), false);
    fs.chmodSync(authHome, 0o755);
    assert.throws(() => createAuthLease(authHome), /private/);
    assert.throws(() => createAuthLease('relative/home'), /absolute/);
    assert.throws(() => createAuthLease(path.join(os.homedir(), '.codex')), /dedicated|ENOENT|private/);
  } finally {
    fs.rmSync(authHome, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('real provider needs opt-in, pins and a credential source, and never ignores the native install config', { skip: !posix }, () => withFixture(cwd => {
  assert.throws(() => createCodexProvider({}), /opt.in/);
  assert.throws(() => createCodexProvider({ allowRealProvider: true }), /model|executable/);
  assert.throws(() => createCodexProvider({ allowRealProvider: true, executable: process.execPath, model: 'm', apiKey: '' }), /auth-home|CODEX_API_KEY/);
  const authHome = privateHome();
  try {
    const calls = [];
    const provider = createCodexProvider({ allowRealProvider: true, executable: process.execPath, model: 'pinned-model', authHome, apiKey: '',
      execute(command, args, options) {
        calls.push({ args, options, leased: fs.existsSync(path.join(options.env.CODEX_HOME, 'auth.json')) });
        return { status: 0, stdout: jsonl() };
      } });
    assert.equal(provider.authentication, 'subscription-lease');
    const codexHome = path.join(cwd, 'codex-home');
    fs.mkdirSync(codexHome);
    const request = { phase: 'selection', input: 'request', cwd, timeoutMs: 5, maxBuffer: 1000,
      env: { PATH: '/bin', HOME: cwd, CODEX_HOME: codexHome, SECRET: 'x', NODE_OPTIONS: '--inspect' } };
    provider(request);
    provider({ ...request, phase: 'task' });
    assert.ok(calls[0].args.includes('read-only'));
    assert.ok(calls[1].args.includes('workspace-write'));
    for (const call of calls) {
      assert.equal(call.leased, true);
      for (const flag of ['--json', '--ephemeral']) assert.ok(call.args.includes(flag));
      for (const flag of ['--ignore-user-config', '--ignore-rules']) assert.ok(!call.args.includes(flag));
      assert.ok(call.args.join(' ').includes('--disable apps --disable remote_plugin'));
      assert.deepEqual(Object.keys(call.options.env).sort(), ['CODEX_HOME', 'HOME', 'PATH']);
      assert.equal(call.options.cwd, cwd);
      assert.equal(call.options.killSignal, 'SIGKILL');
      assert.equal(call.options.shell, false);
    }
    assert.equal(fs.existsSync(path.join(codexHome, 'auth.json')), false);
    const keyed = createCodexProvider({ allowRealProvider: true, executable: process.execPath, model: 'pinned-model', apiKey: 'k',
      execute(command, args, options) { calls.push(options.env); return { status: 0, stdout: jsonl() }; } });
    keyed(request);
    assert.equal(keyed.authentication, 'api-key');
    assert.equal(calls.at(-1).CODEX_API_KEY, 'k');
    const effortful = createCodexProvider({ allowRealProvider: true, executable: process.execPath, model: 'pinned-model', effort: 'high', apiKey: 'k',
      execute(command, args) { calls.push(args); return { status: 0, stdout: jsonl() }; } });
    effortful(request);
    assert.ok(calls.at(-1).includes('model_reasoning_effort="high"'));
    assert.throws(() => createCodexProvider({ allowRealProvider: true, executable: process.execPath, model: 'm', effort: 'huge', apiKey: 'k' }), /effort/);
    assert.equal(preregister({ repoRoot: cwd, corpus: tinyCorpus(), executable: process.execPath, model: 'm', effort: 'high' }).providerPin.effort, 'high');
  } finally { fs.rmSync(authHome, { recursive: true, force: true }); }
}));

test('confidence intervals use distinct task clusters, not repeated calls as independent samples', () => {
  const rows = Array.from({ length: 100 }, (_, repeat) => ['full', 'manual-lean', 'auto-lean', 'baseline']
    .map(arm => ({ id: 'one-task', repeat, arm, passed: true }))).flat();
  const report = summarize(rows);
  assert.equal(report.distinctTasks, 1);
  assert.equal(report.pairs.length, 3);
  assert.equal(report.pairs[0].n, 1);
  assert.ok(report.pairs[0].interval[0] < 0 && report.pairs[0].interval[1] > 0);
  assert.deepEqual(wilson(0, 0), [0, 1]);
  assert.equal(summarize([]).pairs[0].delta, null);
});

test('CLI plan is credential-free JSON and rejects unknown or incomplete flags', () => {
  const cli = path.join(root, 'docker/context-profiles/ai-eval.js');
  const plan = spawnSync(process.execPath, [cli, '--plan'], { encoding: 'utf8' });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).schemaVersion, 'ecc.context-eval-registration.v2');
  for (const args of [['--live'], ['--unknown'], ['--max-calls'], ['--auth-home']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /\/Users\/| at /);
  }
});

test('CLI injection runs the actual workflow using retained preregistration', () => withFixture(repoRoot => {
  const { main } = require('../../docker/context-profiles/ai-eval');
  const corpus = tinyCorpus();
  const filename = path.join(repoRoot, 'registration.json');
  fs.writeFileSync(filename, JSON.stringify(preregister({ repoRoot, corpus })));
  const result = main(['--registration', filename, '--max-calls', '10', '--deadline-ms', '60000'],
    { repoRoot, corpus, provider: providerFor() });
  assert.ok(result.outcomes.every(row => row.passed));
  assert.ok(main(['--help']).usage.includes('--auth-home'));
  assert.throws(() => main(['--plan', '--allow-real-provider']), /separate/);
  assert.throws(() => main(['--plan', '--plan']), /Invalid/);
}));

test('invalid corpus, unsafe workspace paths, bounds and repeats fail before provider calls', () => withFixture(repoRoot => {
  const base = { repoRoot, corpus: tinyCorpus(), provider: () => assert.fail('called') };
  const task = base.corpus.tasks[0];
  for (const options of [{ maxCalls: 0 }, { deadlineMs: 0 }, { callTimeoutMs: 600001 }, { repeats: 0 },
    { corpus: {} }, { corpus: { ...base.corpus, schemaVersion: 'ecc.context-eval-corpus.v1' } },
    { corpus: tinyCorpus({ tasks: [task, task] }) },
    ...['../escape.js', '/abs.js', '.hidden.js', 'a/../b.js'].map(file => ({ corpus: tinyCorpus({ tasks: [{ ...task, files: { [file]: 'x' } }] }) })),
    { corpus: tinyCorpus({ tasks: [{ ...task, manualIds: ['skill:a', 'skill:b'] }] }) },
    { corpus: tinyCorpus({ tasks: [{ ...task, check: '' }] }) }]) {
    assert.throws(() => runEvaluation({ ...base, ...options }));
  }
}));

test('Claude result JSON maps cache-corrected usage and separates provider errors from parse errors', () => {
  const parsed = parseClaudeJson(claudeJson('private text'));
  assert.deepEqual(parsed.usage, { inputTokens: 13, cachedInputTokens: 4, outputTokens: 5 });
  assert.equal(parsed.text, 'private text');
  const denied = parseClaudeJson(JSON.stringify({ type: 'result', result: 'Not logged in', is_error: true,
    usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } }));
  assert.equal(denied.valid, false);
  assert.equal(denied.error, true);
  for (const raw of ['private text', '{}', '{"type":"result"}', '{"type":"result","result":"x","is_error":false,"usage":{"input_tokens":-1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}',
    claudeJson() + '\n' + claudeJson(), 'not json']) {
    assert.equal(parseClaudeJson(raw).valid, false);
  }
});

test('provider family resolves from an explicit flag or the executable name, and effort stays Codex-only', () => {
  assert.equal(resolveFamily('claude', '/x/anything'), 'claude');
  assert.equal(resolveFamily(undefined, '/opt/codex-cli'), 'codex');
  assert.equal(resolveFamily(undefined, '/usr/local/bin/claude'), 'claude');
  assert.equal(resolveFamily(undefined, undefined), 'codex');
  assert.throws(() => resolveFamily('gpt', undefined), /claude or codex/);
  assert.throws(() => resolveFamily(undefined, '/bin/ls'), /Claude or Codex/);
  withFixture(repoRoot => {
    const registration = preregister({ repoRoot, corpus: tinyCorpus(), executable: process.execPath, model: 'm', effort: 'high' });
    assert.throws(() => runEvaluation({ repoRoot, corpus: tinyCorpus(), registration, allowRealProvider: true,
      executable: process.execPath, model: 'm', effort: 'high', family: 'claude' }), /Codex/);
  });
});

test('Claude provider runs tool-free selection and permissioned tasks with a sanitized isolated env', { skip: !posix }, () => withFixture(cwd => {
  assert.throws(() => createClaudeProvider({}), /opt.in/);
  assert.throws(() => createClaudeProvider({ allowRealProvider: true }), /model|executable/);
  const calls = [];
  const provider = createClaudeProvider({ allowRealProvider: true, executable: process.execPath, model: 'pinned-model',
    oauthToken: 'test-token', tokenSource: null,
    execute(command, args, options) { calls.push({ args, options }); return { status: 0, stdout: claudeJson() }; } });
  assert.equal(provider.authentication, 'oauth-env');
  const request = { phase: 'selection', input: 'request', cwd, timeoutMs: 5, maxBuffer: 1000,
    env: { PATH: '/bin', HOME: cwd, CLAUDE_CONFIG_DIR: path.join(cwd, 'cfg'), TMPDIR: '/tmp', CODEX_HOME: '/tmp/x', SECRET: 's' } };
  provider(request);
  provider({ ...request, phase: 'task' });
  assert.ok(calls[0].args.includes('--tools'));
  assert.ok(!calls[0].args.join(' ').includes('bypassPermissions'));
  assert.ok(calls[1].args.includes('--permission-mode') && calls[1].args.includes('bypassPermissions'));
  for (const call of calls) {
    for (const flag of ['--print', '--output-format', 'json', '--no-session-persistence', '--model', 'pinned-model']) assert.ok(call.args.includes(flag));
    assert.deepEqual(Object.keys(call.options.env).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'DISABLE_NON_ESSENTIAL_MODEL_CALLS', 'HOME', 'PATH', 'TMPDIR']);
    assert.equal(call.options.env.CLAUDE_CODE_OAUTH_TOKEN, 'test-token');
    assert.equal(call.options.cwd, cwd);
    assert.equal(call.options.killSignal, 'SIGKILL');
    assert.equal(call.options.shell, false);
  }
  const keyed = createClaudeProvider({ allowRealProvider: true, executable: process.execPath, model: 'm', oauthToken: '',
    apiKey: 'k', tokenSource: null,
    execute(command, args, options) { calls.push({ args, options }); return { status: 0, stdout: claudeJson() }; } });
  keyed(request);
  assert.equal(keyed.authentication, 'api-key');
  assert.equal(calls.at(-1).options.env.ANTHROPIC_API_KEY, 'k');
  assert.ok(!('CLAUDE_CODE_OAUTH_TOKEN' in calls.at(-1).options.env));
  const leased = createClaudeProvider({ allowRealProvider: true, executable: process.execPath, model: 'm', oauthToken: '',
    apiKey: '', tokenSource: () => 'leased-token',
    execute(command, args, options) { calls.push({ args, options }); return { status: 0, stdout: claudeJson() }; } });
  leased(request);
  assert.equal(leased.authentication, 'subscription-keychain-lease');
  assert.equal(calls.at(-1).options.env.CLAUDE_CODE_OAUTH_TOKEN, 'leased-token');
  const denied = createClaudeProvider({ allowRealProvider: true, executable: process.execPath, model: 'm', oauthToken: '',
    apiKey: '', tokenSource: () => { throw new Error('Claude Keychain login is unavailable; provide CLAUDE_CODE_OAUTH_TOKEN'); },
    execute(command, args, options) { return { status: 0, stdout: claudeJson() }; } });
  assert.throws(() => denied(request), /unavailable/);
}));

test('Claude native installs materialize managed skills and detect tampering as environment drift', { skip: !posix }, () => withFixture(repoRoot => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-eval-claude-')));
  try {
    const envs = prepareClaudeEnvironments({ repoRoot, executable: process.execPath, root: temp });
    assert.deepEqual(Object.keys(envs).sort(), ['baseline', 'full', 'lean']);
    for (const name of ['full', 'lean']) {
      assert.equal(envs[name].profileId, `${name}@1`);
      assert.ok(envs[name].skills > 0);
      const installed = fs.readdirSync(path.join(envs[name].launch.claudeConfigDir, 'skills'));
      assert.equal(installed.length, envs[name].skills);
    }
    assert.equal(envs.baseline.profileId, null);
    assert.equal(envs.baseline.skills, 0);
    for (const name of ['baseline', 'full', 'lean']) {
      envs[name].verify();
      envs[name].restore();
    }
    const tampered = path.join(envs.lean.launch.claudeConfigDir, 'skills',
      fs.readdirSync(path.join(envs.lean.launch.claudeConfigDir, 'skills'))[0], 'SKILL.md');
    fs.appendFileSync(tampered, 'tamper');
    assert.throws(() => envs.lean.verify(), /environment-drift/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}));

test('injected Claude-family run parses Claude JSON, isolates config homes, grades checks and maps usage', { skip: !posix }, () => withFixture(repoRoot => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-eval-claude-run-')));
  try {
    const environments = prepareClaudeEnvironments({ repoRoot, executable: process.execPath, root: temp });
    const seen = [];
    const provider = request => {
      seen.push({ ...request, env: { ...request.env } });
      if (request.phase === 'selection') return { status: 0, stdout: claudeJson('{"selectedIds":[]}') };
      fs.writeFileSync(path.join(request.cwd, 'add.js'), FIX);
      return { status: 0, stdout: claudeJson('done') };
    };
    const result = runEvaluation({ repoRoot, corpus: tinyCorpus(), provider, family: 'claude', environments });
    assert.equal(result.evidence, 'injected-provider');
    assert.equal(result.outcomes.length, 4);
    assert.ok(result.outcomes.every(row => row.passed), JSON.stringify(result.outcomes));
    assert.equal(result.installs.full.skills, 5);
    assert.equal(result.installs.lean.skills, 3);
    assert.equal(result.installs.baseline.skills, 0);
    assert.deepEqual(result.usage, { inputTokens: 13 * result.calls, cachedInputTokens: 4 * result.calls, outputTokens: 5 * result.calls });
    const task = arm => seen.find(call => call.phase === 'task' && call.cwd.includes(`--${arm}--`));
    assert.equal(typeof task('full').env.CLAUDE_CONFIG_DIR, 'string');
    assert.equal(task('full').env.CODEX_HOME, undefined);
    assert.notEqual(task('full').env.CLAUDE_CONFIG_DIR, task('manual-lean').env.CLAUDE_CONFIG_DIR);
    assert.equal(task('manual-lean').env.CLAUDE_CONFIG_DIR, task('auto-lean').env.CLAUDE_CONFIG_DIR);
    assert.notEqual(task('baseline').env.CLAUDE_CONFIG_DIR, task('full').env.CLAUDE_CONFIG_DIR);
    assert.doesNotMatch(task('baseline').input, /ecc.selected-context|resources/);
    assert.deepEqual(result.outcomes.find(row => row.arm === 'full').selectedIds, []);
    assert.deepEqual(result.outcomes.find(row => row.arm === 'baseline').selectedIds, []);
    assert.deepEqual(result.outcomes.find(row => row.arm === 'manual-lean').selectedIds, ['skill:feature']);
    const saved = JSON.stringify(result);
    for (const forbidden of ['CLAUDE_CONFIG_DIR', os.tmpdir(), 'leased-token']) assert.ok(!saved.includes(forbidden), forbidden);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}));
