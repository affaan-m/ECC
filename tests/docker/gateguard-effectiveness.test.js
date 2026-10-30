/**
 * Tests for docker/gateguard-effectiveness: scenarios, graders, arms and analysis. No model is called.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'docker', 'gateguard-effectiveness');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'gateguard-fact-force.js');
const lib = require(path.join(DIR, 'lib'));
const arms = require(path.join(DIR, 'arms'));
const { applyArm, armQuestionIds, PLACEBO_TEXT } = require(path.join(DIR, 'arm-patch'));
const { parseArgs, readOptionalText, writeMetadata, withOutputLock } = require(path.join(DIR, 'run'));

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

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function gradeWith(scenario, overlay) {
  const dir = tempDir('gg-eff-grade-');
  try {
    lib.prepareWorkspace(scenario, dir, overlay);
    return lib.grade(scenario, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function gitAvailable() {
  const result = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return result.status === 0 && !result.error;
}

/** Directory of the GNU tar that Git for Windows bundles, or null. GNU tar reads `C:\...` as a remote host:path. */
function gitBundledGnuTarDir() {
  if (process.platform !== 'win32') return null;
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (execPath.status !== 0 || execPath.error) return null;
  // <git>/mingw64/libexec/git-core -> <git>/usr/bin
  const dir = path.resolve(execPath.stdout.trim(), '..', '..', '..', 'usr', 'bin');
  const version = spawnSync(path.join(dir, 'tar.exe'), ['--version'], { encoding: 'utf8' });
  return version.status === 0 && /GNU tar/.test(version.stdout) ? dir : null;
}

console.log('\n=== Testing gateguard-effectiveness ===\n');

const scenarios = lib.loadScenarios();

test('six scenarios load with a target question each', () => {
  assert.strictEqual(scenarios.length, 6);
  for (const scenario of scenarios) assert.ok(scenario.targetQuestions.includes(scenario.question), scenario.id);
});

for (const scenario of scenarios) {
  test(`${scenario.id}: the grader fails the start and naive workspaces and passes the reference`, () => {
    const start = gradeWith(scenario, null);
    const naive = gradeWith(scenario, 'naive');
    const reference = gradeWith(scenario, 'reference');
    assert.strictEqual(start.passed, false, `start ${start.score}`);
    assert.strictEqual(naive.passed, false, `naive ${naive.score}`);
    assert.deepStrictEqual(reference, { passed: true, score: 1 });
    assert.ok(naive.score < 1 && start.score < 1);
  });

  test(`${scenario.id}: the gate asks a target question for the reference edits`, () => {
    const asked = new Set(lib.questionsForReference(scenario, HOOK).flatMap(event => event.questions));
    assert.ok(scenario.targetQuestions.some(question => asked.has(question)), `asked ${[...asked].join(', ')}`);
  });
}

test('dotfiles are stored under dot- names and restored in the workspace', () => {
  const scenario = scenarios.find(item => item.id === 'secrets-config-key');
  const dir = tempDir('gg-eff-dot-');
  try {
    lib.prepareWorkspace(scenario, dir);
    for (const name of ['.env', '.env.example', '.gitignore']) assert.ok(fs.existsSync(path.join(dir, name)), name);
    assert.ok(!fs.readdirSync(dir).some(name => name.startsWith('dot-')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fakeTargetClass() {
  return {
    questionIdsFor: (cls, isWrite) => (cls === 'code' ? ['importers', 'public-api', 'data-schema', 'quote-instruction'] : isWrite ? ['config-reader', 'quote-instruction'] : ['config-effect', 'quote-instruction']),
    questionText: id => `text:${id}`,
    condensedQuestionPhrase: id => `phrase:${id}`,
    condensedHintFor: cls => `original:${cls}`
  };
}

test('dropping a question removes only that question and keeps other classes byte-identical', () => {
  const patched = applyArm({ drop: ['importers'] }, fakeTargetClass());
  assert.deepStrictEqual(patched.questionIdsFor('code', false), ['public-api', 'data-schema', 'quote-instruction']);
  assert.strictEqual(patched.condensedHintFor('config', false), 'original:config');
  assert.ok(!patched.condensedHintFor('code', false).includes('importers'));
  assert.strictEqual(patched.questionText('public-api'), 'text:public-api');
});

test('the placebo keeps the question count and the verbatim-instruction question', () => {
  const original = fakeTargetClass();
  const ids = original.questionIdsFor('code', false);
  const placebo = armQuestionIds({ placebo: true }, ids);
  assert.strictEqual(placebo.length, ids.length);
  assert.strictEqual(placebo[placebo.length - 1], 'quote-instruction');
  assert.ok(placebo.slice(0, -1).every(id => Object.hasOwn(PLACEBO_TEXT, id)));
  const patched = applyArm({ placebo: true }, fakeTargetClass());
  assert.strictEqual(patched.questionText(placebo[0]), PLACEBO_TEXT[placebo[0]]);
  assert.ok(patched.condensedHintFor('code', false).endsWith("the user's verbatim instruction, then retry."));
});

test('no patch leaves the module untouched', () => {
  const original = fakeTargetClass();
  const before = { ...original };
  applyArm(null, original);
  assert.deepStrictEqual(Object.keys(original), Object.keys(before));
  assert.strictEqual(original.questionIdsFor, before.questionIdsFor);
});

test('trial patches follow the arm', () => {
  const scenario = scenarios.find(item => item.id === 'importers-date-shape');
  assert.strictEqual(arms.trialPatch('gate', scenario), null);
  assert.strictEqual(arms.trialPatch('off', scenario), null);
  assert.strictEqual(arms.trialPatch('main', scenario), null);
  assert.deepStrictEqual(arms.trialPatch('minus-target', scenario), { drop: ['importers', 'local-callers'] });
  assert.deepStrictEqual(arms.trialPatch('placebo', scenario), { placebo: true });
  assert.throws(() => arms.trialPatch('nope', scenario), /unknown arm/);
});

test('the off arm registers no hooks and gate arms register the edit and shell matchers', () => {
  assert.deepStrictEqual(arms.armSettings(null), { hooks: {} });
  const settings = arms.armSettings(path.join(os.tmpdir(), 'tree'));
  assert.deepStrictEqual(settings.hooks.PreToolUse.map(entry => entry.matcher), ['Edit|Write|MultiEdit|NotebookEdit', 'Bash|PowerShell']);
  assert.ok(settings.hooks.PreToolUse.every(entry => entry.hooks[0].command.includes(arms.ARM_HOOK) && !entry.hooks[0].command.includes('\\')));
});

test('the schedule runs every arm once per scenario and rep, in a seeded order', () => {
  const trials = lib.schedule(scenarios, arms.DEFAULT_ARMS, 3, 11);
  assert.strictEqual(trials.length, scenarios.length * arms.DEFAULT_ARMS.length * 3);
  assert.strictEqual(new Set(trials.map(trial => trial.key)).size, trials.length);
  assert.deepStrictEqual(lib.schedule(scenarios, arms.DEFAULT_ARMS, 3, 11).map(trial => trial.key), trials.map(trial => trial.key));
  const firstBlock = trials.slice(0, arms.DEFAULT_ARMS.length);
  assert.deepStrictEqual(firstBlock.map(trial => trial.arm).sort(), arms.DEFAULT_ARMS.slice().sort());
});

test('the child environment drops harness and hook variables but keeps the OAuth token', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { CLAUDE_PLUGIN_ROOT: '/x', ECC_GATEGUARD: 'off', GATEGUARD_DISABLED: '1', CLAUDE_CODE_OAUTH_TOKEN: 'token' });
    const env = lib.childEnv('/state');
    assert.strictEqual(env.CLAUDE_PLUGIN_ROOT, undefined);
    assert.strictEqual(env.ECC_GATEGUARD, undefined);
    assert.strictEqual(env.GATEGUARD_DISABLED, undefined);
    assert.strictEqual(env.CLAUDE_CODE_OAUTH_TOKEN, 'token');
    assert.strictEqual(env.GATEGUARD_STATE_DIR, '/state');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('the stream parser counts tools, gate denials and usage', () => {
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'I will check csv.js' }, { type: 'tool_use', name: 'Grep', input: {} }, { type: 'tool_use', name: 'Edit', input: {} }, { type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: [{ type: 'text', text: '[Fact-Forcing Gate]\n\nBefore editing' }] }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    'not json',
    { type: 'result', is_error: false, num_turns: 4, usage: { output_tokens: 9 } }
  ].map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n');
  const parsed = lib.parseStream(lines);
  assert.deepStrictEqual(parsed.tools, { Grep: 1, Edit: 1, Bash: 1 });
  assert.strictEqual(parsed.editCalls, 1);
  assert.strictEqual(parsed.shellCalls, 1);
  assert.strictEqual(parsed.gateDenials, 1);
  assert.strictEqual(parsed.result.num_turns, 4);
  assert.deepStrictEqual(parsed.texts, ['I will check csv.js']);
});

test('evidence recall counts the patterns the agent states', () => {
  const scenario = scenarios.find(item => item.id === 'importers-date-shape');
  assert.strictEqual(lib.evidenceRecall(scenario, ['updated src/report.js and lib/export/csv.js']), 2 / 3);
  assert.strictEqual(lib.evidenceRecall(scenario, []), 0);
});

test('the exact McNemar test matches known values', () => {
  assert.strictEqual(lib.binomialTwoSided(0, 0), 1);
  assert.ok(Math.abs(lib.binomialTwoSided(0, 6) - 0.03125) < 1e-12);
  assert.ok(Math.abs(lib.binomialTwoSided(2, 8) - 0.2890625) < 1e-12);
});

function row(arm, scenario, rep, passedTrial) {
  return { arm, scenario, rep, question: 'q', passed: passedTrial, score: passedTrial ? 1 : 0, evidenceRecall: 0, gateDenials: 0, inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, costUsd: null, turns: 1, wallMs: 1, providerError: false, timedOut: false };
}

test('paired comparisons count discordant pairs and bound the difference', () => {
  const rows = [];
  for (let rep = 1; rep <= 6; rep++) {
    rows.push(row('gate', 's', rep, true), row('off', 's', rep, rep > 5));
  }
  const comparison = lib.pairedComparison(rows, 'gate', 'off');
  assert.strictEqual(comparison.pairs, 6);
  assert.strictEqual(comparison.onlyReference, 5);
  assert.strictEqual(comparison.onlyArm, 0);
  assert.ok(Math.abs(comparison.passRateDifference + 5 / 6) < 1e-12);
  assert.ok(comparison.interval[1] < 0);
  const markdown = lib.renderMarkdown(lib.summarize(rows, ['gate', 'off']), { model: 'm', sha: 'abc', reps: 6 });
  assert.ok(markdown.includes('| off | 6 | -83%'), markdown);
});

test('metadata publication replaces a symlink entry without touching its victim', () => {
  const out = tempDir('gg-eff-meta-');
  try {
    const victim = path.join(out, 'victim');
    const meta = path.join(out, 'meta.json');
    fs.writeFileSync(victim, 'VICTIM_BYTES');
    try { fs.symlinkSync(victim, meta); }
    catch (error) {
      if (process.platform !== 'win32') throw error;
      fs.writeFileSync(meta, 'old');
    }
    writeMetadata(meta, { model: 'fake', sha: 'fixture' });
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'VICTIM_BYTES');
    const fd = fs.openSync(meta, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      assert.strictEqual(fs.fstatSync(fd).isFile(), true);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(fd, 'utf8')), { model: 'fake', sha: 'fixture' });
    } finally { fs.closeSync(fd); }
    assert.ok(!fs.readdirSync(out).some(file => file.endsWith('.tmp')));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('same-output workers are rejected and the lock is released on errors', () => {
  const out = tempDir('gg-eff-lock-');
  try {
    assert.throws(() => withOutputLock(out, () => {
      assert.throws(() => withOutputLock(out, () => assert.fail('second worker started')), /concurrent workers/);
      throw new Error('trial failure');
    }), /trial failure/);
    assert.deepStrictEqual(fs.readdirSync(out), []);
    assert.strictEqual(withOutputLock(out, () => 'resumed'), 'resumed');
    assert.deepStrictEqual(fs.readdirSync(out), []);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('arguments require an output folder, a model and the real-provider opt-in', () => {
  assert.throws(() => parseArgs([]), /--out is required/);
  assert.throws(() => parseArgs(['--out', 'x']), /--model is required/);
  assert.throws(() => parseArgs(['--out', 'x', '--model', 'm']), /--allow-real-provider/);
  assert.throws(() => parseArgs(['--out', 'x', '--arms', 'gate,nope', '--dry-run']), /unknown arm/);
  const options = parseArgs(['--out', 'x', '--model', 'm', '--allow-real-provider', '--reps', '2', '--scenarios', 'a,b']);
  assert.strictEqual(options.reps, 2);
  assert.deepStrictEqual(options.scenarios, ['a', 'b']);
  assert.deepStrictEqual(options.arms, arms.DEFAULT_ARMS);
});

test('materializeTree hands tar no host path, only a relative archive name run inside dest', () => {
  const work = tempDir('gg-eff-tarargs-');
  try {
    const dest = path.join(work, 'tree');
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === 'git') fs.writeFileSync(args[args.indexOf('-o') + 1], '');
      if (command === 'tar') fs.mkdirSync(path.join(dest, 'scripts', 'hooks'), { recursive: true });
      return { status: 0, stdout: '', stderr: '' };
    };
    arms.materializeTree(ROOT, 'deadbeef', dest, spawn);
    const tar = calls.find(call => call.command === 'tar');
    assert.strictEqual(tar.cwd, dest);
    for (const arg of tar.args) {
      assert.ok(!path.isAbsolute(arg) && !/^[A-Za-z]:/.test(arg), `tar argument looks like a host path: ${arg}`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

const gnuTarDir = gitAvailable() ? gitBundledGnuTarDir() : null;
if (gnuTarDir) {
  test('materializeTree extracts into a drive-letter destination when GNU tar is first on PATH', () => {
    const work = tempDir('gg-eff-tar-');
    const savedPath = process.env.PATH;
    try {
      const dest = path.join(work, 'tree');
      assert.match(dest, /^[A-Za-z]:\\/);
      process.env.PATH = `${gnuTarDir}${path.delimiter}${savedPath}`;
      const tree = arms.materializeTree(ROOT, arms.resolveRef(ROOT, 'HEAD'), dest);
      assert.strictEqual(tree, dest);
      assert.ok(fs.existsSync(path.join(dest, 'scripts', 'hooks', 'gateguard-fact-force.js')));
      assert.ok(fs.existsSync(path.join(dest, ...arms.ARM_HOOK.split('/'))));
      assert.ok(!fs.existsSync(path.join(dest, 'scripts.tar')), 'the archive is removed after extraction');
    } finally {
      process.env.PATH = savedPath;
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
}

test('authentication abort recognizes failure diagnostics rather than ordinary discussion', () => {
  const failures = [
    'Not logged in - Please run /login', 'Authentication failed: OAuth token expired',
    'OAuth authentication failed', 'OAuth token expired; sign in again',
    'Authentication is required', 'Login failed', 'Error: Not signed in.',
    'Invalid API key · Please run /login', 'Please run /login', 'Must sign in'
  ];
  const ordinary = [
    'Payment API key authentication uses the Authorization header.',
    'OAuth tokens authorize payment API requests.', 'Login routes use OAuth.',
    'Authentication uses a bearer token.', 'How to use OAuth login',
    'Please explain login flows', 'Authentication failed examples belong in docs',
    'Not logged in errors are covered in tests', '', null
  ];
  for (const text of failures) assert.strictEqual(lib.isAuthenticationFailure(text), true, text);
  for (const text of ordinary) assert.strictEqual(lib.isAuthenticationFailure(text), false, String(text));
});

test('pilot summaries count valid trials only and report provider errors apart', () => {
  const row = (arm, rep, passed, extra = {}) => ({
    key: `s/${arm}/${rep}`, arm, scenario: 's', rep, question: 'q', passed, score: passed ? 1 : 0, evidenceRecall: 0, gateDenials: 0,
    inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, costUsd: null, turns: 1, wallMs: 1, providerError: false, timedOut: false, ...extra
  });
  const rows = [
    row('gate', 1, true),
    row('gate', 2, false, { providerError: true }),
    row('gate', 2, true),
    row('gate', 3, false, { timedOut: true }),
    row('gate', 4, false, { judgeFailed: true }),
    row('off', 1, true)
  ];
  const gate = lib.summarize(rows, ['gate', 'off']).arms.find(arm => arm.arm === 'gate');
  assert.strictEqual(gate.trials, 2, 'a provider error or timeout is not a trial');
  assert.strictEqual(gate.passes, 2);
  assert.strictEqual(gate.meanScore, 1);
  assert.strictEqual(gate.providerErrors, 2);
  assert.deepStrictEqual([...lib.completedTrialKeys(rows)].sort(), ['s/gate/1', 's/gate/2', 's/off/1']);
});

/** The pilot runner driven end to end with fake-claude.js as the provider. */
function syntheticPilotRunner(root, scenario, arms, streamEvents = null) {
  const out = path.join(root, 'out');
  const preload = path.join(root, 'preload.js');
  fs.writeFileSync(preload, `
    const cp = require('child_process');
    const originalSpawn = cp.spawnSync;
    cp.spawnSync = (file, args, options) => file === 'ecc-fake-claude'
      ? ${streamEvents === null
        ? `originalSpawn(process.execPath, [${JSON.stringify(path.join(DIR, 'fake-claude.js'))}, ...args], options)`
        : JSON.stringify({ status: 0, stdout: streamEvents.map(event => JSON.stringify(event)).join('\n') + '\n', stderr: '' })}
      : originalSpawn(file, args, options);
  `);
  const args = ['--require', preload, path.join(DIR, 'run.js'), '--out', out, '--model', 'fake', '--claude', 'ecc-fake-claude', '--allow-real-provider', '--arms', arms, '--reps', '1', '--scenarios', scenario.id];
  const env = { ...process.env, FAKE_CLAUDE_OVERLAY: path.join(scenario.root, 'reference') };
  const run = extraEnv => spawnSync(process.execPath, args, { env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 60000 });
  const results = () => {
    const file = path.join(out, 'results.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  };
  return { out, run, results };
}

if (gitAvailable()) {
  test('a pilot trial that ended in a provider error is retried on resume', () => {
    const root = tempDir('gg-eff-retry-');
    try {
      const scenario = scenarios.find(item => item.id === 'importers-date-shape');
      const { out, run, results } = syntheticPilotRunner(root, scenario, 'off');
      const failed = run({ FAKE_CLAUDE_PROVIDER_ERROR: '1' });
      assert.strictEqual(failed.status, 0, failed.stderr);
      assert.deepStrictEqual(results().map(row => row.providerError), [true]);
      const retried = run({});
      assert.strictEqual(retried.status, 0, retried.stderr);
      assert.ok(retried.stderr.includes('1 trials to run'), retried.stderr);
      const rows = results();
      assert.deepStrictEqual(rows.map(row => row.providerError), [true, false], 'the failed attempt stays for audit');
      assert.strictEqual(rows[1].passed, true);
      assert.notStrictEqual(rows[0].transcript, rows[1].transcript, 'each attempt keeps its own transcript');
      const { summary } = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
      const off = summary.arms.find(arm => arm.arm === 'off');
      assert.deepStrictEqual([off.trials, off.passes, off.providerErrors], [1, 1, 1]);
      const again = run({});
      assert.ok(again.stderr.includes('0 trials to run'), again.stderr);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('assistant-only authentication failures retain transcripts and abort before pilot rows', () => {
    for (const [text, trailing] of [
      ['Not logged in - Please run /login', null], ['Authentication failed: OAuth token expired', null],
      ['Not logged in - Please run /login', ''], ['Authentication failed: OAuth token expired', '  \t  ']
    ]) {
      const root = tempDir('gg-eff-auth-');
      try {
        const scenario = scenarios.find(item => item.id === 'importers-date-shape');
        const events = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'Preparing' }, { type: 'text', text }] } }];
        if (trailing !== null) events.push({ type: 'assistant', message: { content: [{ type: 'text', text: trailing }] } });
        const { out, run, results } = syntheticPilotRunner(root, scenario, 'off', events);
        const auth = run({});
        assert.strictEqual(auth.status, 2, auth.stderr);
        assert.match(auth.stderr, /not signed in/);
        assert.deepStrictEqual(results(), [], 'authentication is not recorded as a completed or failed trial row');
        const files = fs.readdirSync(path.join(out, 'transcripts'));
        assert.strictEqual(files.length, 1);
        const retained = fs.readFileSync(path.join(out, 'transcripts', files[0]), 'utf8');
        assert.ok(retained.includes(text));
        assert.ok(!fs.existsSync(path.join(out, '.run.lock')));
        const resumed = syntheticPilotRunner(root, scenario, 'off').run({});
        assert.strictEqual(resumed.status, 0, resumed.stderr);
        assert.strictEqual(results().length, 1);
        assert.strictEqual(results()[0].providerError, false);
        assert.strictEqual(fs.readdirSync(path.join(out, 'transcripts')).length, 2);
        assert.strictEqual(fs.readFileSync(path.join(out, 'transcripts', files[0]), 'utf8'), retained);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
  });

  test('missing-result messages preserve ordinary failures, empty text and result mapping', () => {
    const root = tempDir('gg-eff-messages-');
    try {
      const scenario = scenarios.find(item => item.id === 'importers-date-shape');
      const text = value => ({ type: 'assistant', message: { content: [{ type: 'text', text: value }] } });
      const cases = [
        [[text('Provider connection closed')], true, 'Provider connection closed'],
        [[text('old'), text('')], true, 'old'],
        [[], true, null],
        [[text('  \t  ')], true, null],
        [[text('old'), text('   '), text('Latest diagnostic'), text('')], true, 'Latest diagnostic'],
        [[text('x'.repeat(250))], true, 'x'.repeat(200)],
        [[text('Not logged in'), { type: 'result', is_error: false, result: 'Done' }], false, null],
        [[text('Ignored'), { type: 'result', is_error: true, result: 'Result error' }], true, 'Result error']
      ];
      for (const [events, error, message] of cases) {
        const row = lib.runTrial({ key: 'mapping/off/1', scenario, arm: 'off', rep: 1 }, {
          workRoot: root, armSettingsByName: { off: arms.armSettings(null) }, executable: 'controlled',
          model: 'fake', maxTurns: 1, timeoutMs: 1000,
          execute: () => ({ status: 0, stdout: events.map(event => JSON.stringify(event)).join('\n'), stderr: '' })
        });
        assert.strictEqual(row.providerError, error);
        assert.strictEqual(row.providerMessage, message);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('ordinary authentication discussion remains a failed-attempt row on missing result', () => {
    for (const text of ['Payment API key authentication uses the Authorization header.', 'OAuth tokens authorize payment API requests.']) {
      const root = tempDir('gg-eff-auth-discussion-');
      try {
        const scenario = scenarios.find(item => item.id === 'importers-date-shape');
        const events = [{ type: 'assistant', message: { content: [{ type: 'text', text }] } }];
        const { out, run, results } = syntheticPilotRunner(root, scenario, 'off', events);
        const result = run({});
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(results().length, 1);
        assert.strictEqual(results()[0].providerError, true);
        assert.strictEqual(results()[0].providerMessage, text);
        assert.strictEqual(fs.readdirSync(path.join(out, 'transcripts')).length, 1);
        assert.ok(!fs.existsSync(path.join(out, '.run.lock')));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
  });

  test('the pilot runner stops before recording a gated trial whose hook never ran', () => {
    const root = tempDir('gg-eff-hookless-');
    try {
      const scenario = scenarios.find(item => item.id === 'importers-date-shape');
      const { run, results } = syntheticPilotRunner(root, scenario, 'gate');
      const result = run({ FAKE_CLAUDE_SKIP_HOOK: '1' });
      assert.notStrictEqual(result.status, 0, 'a hookless gated trial must stop the run');
      assert.match(result.stderr, /the gate did not run although the agent edited files/);
      assert.deepStrictEqual(results(), [], 'the hookless trial is not recorded as data');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('actual fake-provider CLI resumes identity and resists a metadata publication symlink race', () => {
    const root = tempDir('gg-eff-cli-');
    const out = path.join(root, 'out');
    const victim = path.join(root, 'victim');
    const preload = path.join(root, 'preload.js');
    const scenario = scenarios.find(item => item.id === 'importers-date-shape');
    try {
      fs.writeFileSync(victim, 'VICTIM_BYTES');
      fs.writeFileSync(preload, `
        const cp = require('child_process');
        const originalSpawn = cp.spawnSync;
        cp.spawnSync = (file, args, options) => file === 'ecc-fake-claude'
          ? originalSpawn(process.execPath, [${JSON.stringify(path.join(DIR, 'fake-claude.js'))}, ...args], options)
          : originalSpawn(file, args, options);
        if (process.env.ECC_TEST_META_RACE === '1') {
          const fs = require('fs');
          const rename = fs.renameSync;
          fs.renameSync = (from, to) => {
            if (String(to).endsWith('meta.json')) {
              fs.unlinkSync(to);
              fs.symlinkSync(${JSON.stringify(victim)}, to);
            }
            return rename(from, to);
          };
        }
      `);
      const args = ['--require', preload, path.join(DIR, 'run.js'), '--out', out, '--model', 'fake', '--claude', 'ecc-fake-claude', '--allow-real-provider', '--arms', 'off', '--reps', '1', '--scenarios', scenario.id];
      const env = { ...process.env, FAKE_CLAUDE_OVERLAY: path.join(scenario.root, 'reference') };
      const run = extraEnv => spawnSync(process.execPath, args, { env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 60000 });
      const first = run({});
      assert.strictEqual(first.status, 0, first.stderr);
      const metaPath = path.join(out, 'meta.json');
      const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      assert.strictEqual(metadata.model, 'fake');
      assert.strictEqual(metadata.sha, arms.resolveRef(ROOT, 'HEAD'));
      const results = fs.readFileSync(path.join(out, 'results.jsonl'), 'utf8');
      assert.strictEqual(results.trim().split('\n').length, 1);
      assert.strictEqual(JSON.parse(results.trim()).passed, true);
      const second = run({});
      assert.strictEqual(second.status, 0, second.stderr);
      assert.ok(second.stderr.includes('0 trials to run'));
      assert.strictEqual(fs.readFileSync(path.join(out, 'results.jsonl'), 'utf8'), results);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(metaPath, 'utf8')), metadata);
      if (process.platform !== 'win32') {
        const resultsPath = path.join(out, 'results.jsonl');
        for (const file of [metaPath, resultsPath]) {
          const original = fs.readFileSync(file, 'utf8');
          fs.unlinkSync(file);
          fs.symlinkSync(victim, file);
          const early = run({});
          assert.notStrictEqual(early.status, 0, 'early symlink must prevent a trial');
          assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'VICTIM_BYTES');
          assert.throws(() => readOptionalText(file, { ...fs, constants: { ...fs.constants, O_NOFOLLOW: 0 } }), /without symlinks/);
          fs.unlinkSync(file);
          fs.writeFileSync(file, original, { flag: 'wx', mode: 0o600 });
        }
        assert.strictEqual(fs.readFileSync(resultsPath, 'utf8'), results);
        const raced = run({ ECC_TEST_META_RACE: '1' });
        assert.strictEqual(raced.status, 0, raced.stderr);
        assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'VICTIM_BYTES');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(metaPath, 'utf8')), metadata);
        assert.strictEqual(fs.readFileSync(path.join(out, 'results.jsonl'), 'utf8'), results);
      }
      assert.ok(!fs.readdirSync(out).includes('.run.lock'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('a trial wires the arm hook, counts the denial and grades the result (test double for Claude)', () => {
    const work = tempDir('gg-eff-trial-');
    const saved = process.env.FAKE_CLAUDE_OVERLAY;
    try {
      const sha = arms.resolveRef(ROOT, 'HEAD');
      const tree = arms.materializeTree(ROOT, sha, path.join(work, 'tree'));
      const scenario = scenarios.find(item => item.id === 'importers-date-shape');
      process.env.FAKE_CLAUDE_OVERLAY = path.join(scenario.root, 'reference');
      const execute = (_file, args, options) => spawnSync(process.execPath, [path.join(DIR, 'fake-claude.js'), ...args], options);
      const settings = arms.armSettings(tree);
      const common = { workRoot: work, armSettingsByName: { gate: settings, 'minus-target': settings, off: arms.armSettings(null) }, executable: 'claude', model: 'fake', maxTurns: 5, timeoutMs: 60000, execute };
      const gated = lib.runTrial({ key: `${scenario.id}/gate/1`, scenario, arm: 'gate', rep: 1 }, common);
      assert.strictEqual(gated.passed, true);
      assert.strictEqual(gated.gateDenials, 1);
      assert.strictEqual(gated.denials, 1);
      assert.strictEqual(gated.hookObserved, true);
      assert.ok(gated.questionsAsked.includes('importers'), gated.questionsAsked.join(','));
      assert.strictEqual(gated.turns, 3);
      assert.strictEqual(gated.inputTokens, 150);
      assert.strictEqual(gated.evidenceRecall, 1);
      const ablated = lib.runTrial({ key: `${scenario.id}/minus-target/1`, scenario, arm: 'minus-target', rep: 1 }, common);
      assert.strictEqual(ablated.gateDenials, 1);
      assert.ok(!ablated.questionsAsked.some(question => scenario.targetQuestions.includes(question)), ablated.questionsAsked.join(','));
      const off = lib.runTrial({ key: `${scenario.id}/off/1`, scenario, arm: 'off', rep: 1 }, common);
      assert.strictEqual(off.gateDenials, 0);
      assert.strictEqual(off.passed, true);
    } finally {
      if (saved === undefined) delete process.env.FAKE_CLAUDE_OVERLAY;
      else process.env.FAKE_CLAUDE_OVERLAY = saved;
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
