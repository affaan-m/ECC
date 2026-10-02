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
const { parseArgs } = require(path.join(DIR, 'run'));

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
    { type: 'assistant', message: { content: [{ type: 'text', text: 'I will check csv.js' }, { type: 'tool_use', name: 'Grep', input: {} }, { type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: [{ type: 'text', text: '[Fact-Forcing Gate]\n\nBefore editing' }] }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    'not json',
    { type: 'result', is_error: false, num_turns: 4, usage: { output_tokens: 9 } }
  ].map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n');
  const parsed = lib.parseStream(lines);
  assert.deepStrictEqual(parsed.tools, { Grep: 1, Edit: 1 });
  assert.strictEqual(parsed.editCalls, 1);
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

if (gitAvailable()) {
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
