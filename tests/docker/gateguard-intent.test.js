/**
 * Tests for the hidden-intent effectiveness harness. No model is called: the
 * session executable and the simulated user are both injected.
 *
 * These tests deliberately assert nothing about which question the gate raises.
 * The previous suite did, using targets copied from the gate's own taxonomy, so
 * it passed by construction. What is asserted here are properties that can
 * actually fail: that scenarios are authored blind, that every grader separates
 * the start, the trap and a correct solution, that behaviour is classified into
 * the right hole, and that a scenario carrying no information is excluded from
 * arm comparison instead of being reported as a result.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'docker', 'gateguard-effectiveness');
const userSim = require(path.join(DIR, 'user-sim'));
const session = require(path.join(DIR, 'session'));
const coverage = require(path.join(DIR, 'coverage'));
const intentEval = require(path.join(DIR, 'intent-eval'));
const { parseArgs } = require(path.join(DIR, 'run-intent'));

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

const INTENT = Object.freeze({
  id: 'probe',
  ambiguity: 'the window and the delete mode were never stated',
  facts: [
    { id: 'window', fact: 'The window is 400 days.', decisive: true },
    { id: 'mode', fact: 'Rows are marked, never removed.', decisive: true },
    { id: 'ordering', fact: 'Order does not matter.', decisive: false }
  ],
  stonewall: 'No strong view - use your judgement.',
  volunteer: false
});

function row(overrides) {
  return {
    scenario: 'probe', arm: 'gate', rep: 1, passed: false, asked: false,
    disclosedDecisive: false, gateDenials: 0, questionsAsked: [], ...overrides
  };
}

// --- scenarios are authored blind to the taxonomy ---

test('every shipped hidden-intent scenario loads and declares a decisive fact', () => {
  const scenarios = intentEval.loadIntentScenarios();
  assert.ok(scenarios.length > 0, 'no hidden-intent scenarios found');
  for (const scenario of scenarios) {
    assert.ok(userSim.decisiveFacts(scenario.intent).length > 0, `${scenario.id} has no decisive fact`);
    assert.strictEqual(scenario.targetQuestions, undefined, `${scenario.id} declares targetQuestions`);
  }
});

test('a scenario that declares targetQuestions is rejected', () => {
  const dir = tempDir('gg-blind-');
  const scenario = path.join(dir, 'leaky');
  fs.mkdirSync(path.join(scenario, 'workspace'), { recursive: true });
  fs.writeFileSync(
    path.join(scenario, 'task.json'),
    JSON.stringify({ id: 'leaky', trap: 't', prompt: 'p', evidence: ['e'], targetQuestions: ['no-duplicate'] })
  );
  fs.writeFileSync(path.join(scenario, 'intent.json'), JSON.stringify(INTENT));
  fs.writeFileSync(path.join(scenario, 'grader.cjs'), 'console.log("ECC_EVAL_SCORE {\\"score\\":0}");');
  assert.throws(() => intentEval.loadIntentScenarios(dir), /authored blind to the taxonomy/);
});

test('an intent with no decisive fact is rejected', () => {
  const dir = tempDir('gg-nodecisive-');
  const scenario = path.join(dir, 'soft');
  fs.mkdirSync(path.join(scenario, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(scenario, 'task.json'), JSON.stringify({ id: 'soft', trap: 't', prompt: 'p', evidence: ['e'] }));
  fs.writeFileSync(
    path.join(scenario, 'intent.json'),
    JSON.stringify({ ...INTENT, facts: [{ id: 'ordering', fact: 'Order does not matter.', decisive: false }] })
  );
  fs.writeFileSync(path.join(scenario, 'grader.cjs'), 'console.log("ECC_EVAL_SCORE {\\"score\\":0}");');
  assert.throws(() => intentEval.loadIntentScenarios(dir), /no decisive fact/);
});

// --- graders must discriminate, or the trial is worthless ---

test('every grader separates the start, the trap and a correct solution', () => {
  const workRoot = tempDir('gg-sound-');
  for (const scenario of intentEval.loadIntentScenarios()) {
    const { scores, sound } = intentEval.graderIsSound(scenario, workRoot);
    assert.ok(
      sound,
      `${scenario.id}: start=${scores.workspace} trap=${scores.naive} reference=${scores.reference}`
    );
  }
});

// --- behaviour is classified into the right hole ---

test('classify maps each behaviour to its hole', () => {
  const cases = [
    [{ disclosedDecisive: true, passed: true, asked: true, gateDenials: 1 }, 'working'],
    [{ disclosedDecisive: true, passed: false, asked: true, gateDenials: 1 }, 'follow-through-hole'],
    [{ asked: true, disclosedDecisive: false, passed: false, gateDenials: 1 }, 'targeting-hole'],
    [{ asked: true, disclosedDecisive: false, passed: true, gateDenials: 1 }, 'targeting-hole'],
    [{ asked: false, passed: false, gateDenials: 3 }, 'silence-hole'],
    [{ asked: false, passed: false, gateDenials: 0 }, 'coverage-hole'],
    // The gate-specific holes are unreachable for an arm that has no gate, or
    // every ungated miss is a coverage-hole by construction.
    [{ arm: 'off', gated: false, asked: false, passed: false, gateDenials: 0 }, 'unaided-miss'],
    [{ asked: false, passed: true, gateDenials: 0 }, 'lucky']
  ];
  for (const [fields, expected] of cases) {
    assert.strictEqual(coverage.classify(row(fields)), expected, JSON.stringify(fields));
  }
});

test('a right outcome reached without asking is lucky, not working', () => {
  // The distinction is the whole point: a scenario that can be passed without
  // the deciding fact cannot measure the gate.
  assert.strictEqual(coverage.classify(row({ passed: true, asked: false, disclosedDecisive: false })), 'lucky');
});

// --- non-informative scenarios are excluded, not reported as results ---

test('trap strength is read from the ungated arm alone', () => {
  const rows = [
    row({ scenario: 'easy', arm: 'off', passed: true }),
    row({ scenario: 'easy', arm: 'off', passed: true }),
    row({ scenario: 'hard', arm: 'off', passed: false }),
    row({ scenario: 'hard', arm: 'off', passed: false }),
    row({ scenario: 'mid', arm: 'off', passed: true }),
    row({ scenario: 'mid', arm: 'off', passed: false })
  ];
  const byScenario = Object.fromEntries(coverage.difficulty(rows).map(entry => [entry.scenario, entry.label]));
  // A trap the ungated arm always beats is no trap; anything else traps at least sometimes.
  assert.deepStrictEqual(byScenario, { easy: 'ceiling', hard: 'traps', mid: 'traps' });
});

test('usability is judged across arms, so an ungated arm that fails is not discarded', () => {
  // This is the case the first cut got wrong: off failing every time is exactly
  // what a working trap looks like, and must not make the scenario unusable.
  const rows = [
    row({ scenario: 'works', arm: 'off', passed: false }),
    row({ scenario: 'works', arm: 'gate', passed: true }),
    row({ scenario: 'unreached', arm: 'off', passed: false }),
    row({ scenario: 'unreached', arm: 'gate', passed: false }),
    row({ scenario: 'toothless', arm: 'off', passed: true }),
    row({ scenario: 'toothless', arm: 'gate', passed: true })
  ];
  const byScenario = Object.fromEntries(coverage.informative(rows).map(entry => [entry.scenario, entry.label]));
  assert.deepStrictEqual(byScenario, { works: 'informative', unreached: 'floor', toothless: 'ceiling' });
});

test('a ceiling scenario is excluded from the outcome-class table', () => {
  const rows = [
    row({ scenario: 'easy', arm: 'off', passed: true }),
    row({ scenario: 'easy', arm: 'gate', passed: true, asked: true, disclosedDecisive: true, gateDenials: 1 }),
    row({ scenario: 'mid', arm: 'off', passed: false }),
    row({ scenario: 'mid', arm: 'gate', passed: true, asked: true, disclosedDecisive: true, gateDenials: 1 })
  ];
  const report = coverage.renderHoles(rows);
  assert.match(report, /easy: ceiling/);
  assert.match(report, /carry no information/);
  // Only the informative scenario's gate trial is counted as working. Scope the
  // lookup to the outcome-class table: the effect table also has a `gate` row.
  const classTable = report.slice(report.indexOf('### Outcome classes'));
  const gateLine = classTable.split('\n').find(line => line.startsWith('| gate |'));
  assert.strictEqual(gateLine.split('|')[2].trim(), '1', gateLine);
});

test('a small run is reported as underpowered, not as evidence', () => {
  // The counts this harness prints look like a result. With a handful of trials
  // they are not, so the report has to say so next to them.
  const rows = [
    row({ scenario: 'works', rep: 1, arm: 'off', passed: false }),
    row({ scenario: 'works', rep: 1, arm: 'gate', passed: true, turns: 8, costUsd: 0.1 }),
    row({ scenario: 'works', rep: 2, arm: 'off', passed: false }),
    row({ scenario: 'works', rep: 2, arm: 'gate', passed: false, turns: 7, costUsd: 0.1 })
  ];
  const report = coverage.renderEffect(rows);
  assert.match(report, /Underpowered: 2 pair\(s\)/);
  assert.match(report, /not as evidence that `gate` beats `off`/);
  // The exact paired test must be shown beside the counts.
  assert.match(report, /McNemar p/);
  assert.match(report, /\| off \| 2 \|/);
});

test('the underpowered warning clears once there are enough pairs', () => {
  const rows = [];
  for (let rep = 1; rep <= coverage.MIN_PAIRS_FOR_A_CLAIM; rep++) {
    rows.push(row({ scenario: 'works', rep, arm: 'off', passed: false }));
    rows.push(row({ scenario: 'works', rep, arm: 'gate', passed: true, turns: 8, costUsd: 0.1 }));
  }
  const report = coverage.renderEffect(rows);
  assert.ok(!/Underpowered/.test(report), report);
  assert.match(report, /\| gate \| 20\/20 \|/);
});

test('unengaged reports scenarios the gate never fired on', () => {
  const rows = [
    row({ scenario: 'quiet', arm: 'gate', gateDenials: 0 }),
    row({ scenario: 'quiet', arm: 'placebo', gateDenials: 0 }),
    row({ scenario: 'noisy', arm: 'gate', gateDenials: 2 })
  ];
  assert.deepStrictEqual(coverage.unengaged(rows), ['quiet']);
});

test('discovered questions are observed, never declared', () => {
  const rows = [
    row({ scenario: 'probe', arm: 'gate', questionsAsked: ['data-schema'] }),
    row({ scenario: 'probe', arm: 'gate', questionsAsked: ['importers', 'data-schema'] })
  ];
  assert.deepStrictEqual(coverage.discoveredQuestions(rows), [
    { scenario: 'probe', questions: ['data-schema', 'importers'] }
  ]);
});

// --- the simulated user withholds unless actually asked ---

test('parseJudge tolerates prose and fences around the object', () => {
  assert.deepStrictEqual(userSim.parseJudge('sure thing\n```json\n{"isQuestion":true,"reply":"hi","disclosed":[]}\n```'), {
    isQuestion: true, reply: 'hi', disclosed: []
  });
  assert.strictEqual(userSim.parseJudge('no json here'), null);
});

test('answer keeps only fact ids the scenario declares', () => {
  const execute = () => ({ stdout: '{"isQuestion":true,"reply":"400 days","disclosed":["window","invented"]}', status: 0 });
  const reply = userSim.answer(INTENT, 'how long is the window?', { execute });
  assert.deepStrictEqual(reply.disclosed, ['window']);
  assert.strictEqual(reply.judgeFailed, false);
});

test('an unparseable judge is a flagged failure, not a silent stonewall', () => {
  const execute = () => ({ stdout: 'the model rambled', status: 0 });
  const reply = userSim.answer(INTENT, 'anything?', { execute });
  assert.strictEqual(reply.judgeFailed, true);
  assert.strictEqual(reply.isQuestion, false);
});

// --- the conversation driver ---

test('session args use session-id first, resume after, and never disable persistence', () => {
  const first = session.sessionArgs({ model: 'm', settingsPath: 's', maxTurns: 5 }, null);
  assert.ok(first.includes('--session-id'));
  assert.ok(!first.includes('--resume'));
  // --no-session-persistence would make --resume impossible, which is how the
  // one-shot runner is configured; this guards against copying that flag over.
  assert.ok(!first.includes('--no-session-persistence'));
  const next = session.sessionArgs({ model: 'm', settingsPath: 's', maxTurns: 5 }, 'abc');
  assert.deepStrictEqual(next.slice(-2), ['--resume', 'abc']);
});

function streamFor(text, { denials = 0 } = {}) {
  const lines = [];
  for (let i = 0; i < denials; i++) {
    lines.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: '[Fact-Forcing Gate] state facts' }] } }));
  }
  lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
  lines.push(JSON.stringify({ type: 'result', usage: { input_tokens: 10, output_tokens: 5 }, num_turns: 2, total_cost_usd: 0.01 }));
  return { stdout: lines.join('\n'), status: 0 };
}

test('the conversation stops as soon as the agent stops asking', () => {
  let calls = 0;
  const execute = () => {
    calls++;
    return streamFor('done, no questions');
  };
  const judge = () => ({ isQuestion: false, reply: INTENT.stonewall, disclosed: [], judgeFailed: false });
  const result = session.runConversation(
    { cwd: '.', stateDir: '.', settingsPath: 's', prompt: 'p', intent: INTENT },
    { model: 'm', maxTurns: 5, timeoutMs: 1000, userTurns: 3, execute, judge }
  );
  assert.strictEqual(calls, 1);
  assert.strictEqual(result.asked, false);
  assert.strictEqual(result.disclosedDecisive, false);
});

test('a question is answered and the reply is fed back as the next turn', () => {
  const inputs = [];
  const execute = (file, args, options) => {
    inputs.push(options.input);
    return streamFor(inputs.length === 1 ? 'how long is the window?' : 'done', { denials: 1 });
  };
  let asked = 0;
  const judge = () => {
    asked++;
    return asked === 1
      ? { isQuestion: true, reply: '400 days, and mark them', disclosed: ['window', 'mode'], judgeFailed: false }
      : { isQuestion: false, reply: INTENT.stonewall, disclosed: [], judgeFailed: false };
  };
  const result = session.runConversation(
    { cwd: '.', stateDir: '.', settingsPath: 's', prompt: 'build it', intent: INTENT },
    { model: 'm', maxTurns: 5, timeoutMs: 1000, userTurns: 3, execute, judge }
  );
  assert.match(inputs[0], /build it/);
  assert.strictEqual(inputs[1], '400 days, and mark them');
  assert.strictEqual(result.asked, true);
  assert.strictEqual(result.disclosedDecisive, true);
  assert.strictEqual(result.userTurns, 1);
  assert.strictEqual(result.gateDenials, 2);
});

test('a timeout on an earlier turn is not cleared by a later clean turn', () => {
  let call = 0;
  const execute = () => {
    call++;
    if (call === 1) return { stdout: '', status: null, error: { code: 'ETIMEDOUT' } };
    return streamFor('done');
  };
  let asked = 0;
  const judge = () => {
    asked++;
    return asked === 1
      ? { isQuestion: true, reply: 'carry on', disclosed: [], judgeFailed: false }
      : { isQuestion: false, reply: INTENT.stonewall, disclosed: [], judgeFailed: false };
  };
  const result = session.runConversation(
    { cwd: '.', stateDir: '.', settingsPath: 's', prompt: 'p', intent: INTENT },
    { model: 'm', maxTurns: 5, timeoutMs: 1000, userTurns: 2, execute, judge }
  );
  assert.strictEqual(result.timedOut, true);
});

test('the config directory is never isolated, because that hides the credentials', () => {
  // A per-trial CLAUDE_CONFIG_DIR looks like the right way to stop persisted
  // sessions piling up, but it makes every turn return "Not logged in", and the
  // trial is then graded as a coverage hole. Guard against reintroducing it.
  let seen = 'unset';
  const execute = (file, args, options) => {
    seen = options.env.CLAUDE_CONFIG_DIR;
    return streamFor('done');
  };
  const judge = () => ({ isQuestion: false, reply: INTENT.stonewall, disclosed: [], judgeFailed: false });
  session.runConversation(
    { cwd: '.', stateDir: '.', settingsPath: 's', prompt: 'p', intent: INTENT },
    { model: 'm', maxTurns: 5, timeoutMs: 1000, userTurns: 1, execute, judge }
  );
  assert.strictEqual(seen, process.env.CLAUDE_CONFIG_DIR);
});

test('a missing or errored result is a provider error, not a trial', () => {
  const noResult = () => ({ stdout: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Not logged in - Please run /login' }] } }), status: 1 });
  const judge = () => ({ isQuestion: false, reply: INTENT.stonewall, disclosed: [], judgeFailed: false });
  const result = session.runConversation(
    { cwd: '.', stateDir: '.', settingsPath: 's', prompt: 'p', intent: INTENT },
    { model: 'm', maxTurns: 5, timeoutMs: 1000, userTurns: 1, execute: noResult, judge }
  );
  assert.strictEqual(result.providerError, true);
  assert.match(result.providerMessage, /Not logged in/);
  // The runner turns this into a thrown error rather than a graded row.
  assert.match(result.providerMessage, /log ?in/i);
});

test('denials are recorded per turn, so the once-per-session latch is visible', () => {
  let call = 0;
  const execute = () => {
    call++;
    // The gate fires on the first touch and is silent afterwards because the
    // file is already marked checked, not because it chose to stay quiet.
    return call === 1 ? streamFor('which window?', { denials: 2 }) : streamFor('done', { denials: 0 });
  };
  let asked = 0;
  const judge = () => {
    asked++;
    return asked === 1
      ? { isQuestion: true, reply: '400 days, mark them', disclosed: ['window', 'mode'], judgeFailed: false }
      : { isQuestion: false, reply: INTENT.stonewall, disclosed: [], judgeFailed: false };
  };
  const result = session.runConversation(
    { cwd: '.', stateDir: '.', settingsPath: 's', prompt: 'p', intent: INTENT },
    { model: 'm', maxTurns: 5, timeoutMs: 1000, userTurns: 2, execute, judge }
  );
  assert.deepStrictEqual(result.denialsPerTurn, [2, 0]);
  assert.strictEqual(result.gateDenials, 2);
});

test('disclosedDecisive needs every decisive fact, not just one', () => {
  const execute = () => streamFor('how long is the window?');
  const judge = () => ({ isQuestion: true, reply: '400 days', disclosed: ['window'], judgeFailed: false });
  const result = session.runConversation(
    { cwd: '.', stateDir: '.', settingsPath: 's', prompt: 'p', intent: INTENT },
    { model: 'm', maxTurns: 5, timeoutMs: 1000, userTurns: 1, execute, judge }
  );
  assert.deepStrictEqual(result.disclosed, ['window']);
  assert.strictEqual(result.disclosedDecisive, false);
});

// --- CLI guards ---

test('minus-target is refused: it needs declared targets these scenarios lack', () => {
  assert.throws(
    () => parseArgs(['--out', 'o', '--model', 'm', '--allow-real-provider', '--arms', 'minus-target']),
    /not supported for hidden-intent scenarios/
  );
});

test('real sessions require the explicit flag', () => {
  assert.throws(() => parseArgs(['--out', 'o', '--model', 'm']), /--allow-real-provider/);
  assert.doesNotThrow(() => parseArgs(['--out', 'o', '--dry-run']));
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
