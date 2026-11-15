/**
 * Tests for the hidden-intent effectiveness harness. No model is called: the
 * session executable and the simulated user are both injected.
 *
 * These tests deliberately assert nothing about which question the gate raises.
 * The previous suite did, using targets copied from the gate's own taxonomy, so
 * it passed by construction. What is asserted here are properties that can
 * actually fail: that scenarios do not encode target questions, that every grader separates
 * the start, the trap and a correct solution, that behaviour is classified into
 * the right hole, and that non-informative outcome classes are kept descriptive
 * while every valid predeclared scenario remains in the primary comparison.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'docker', 'gateguard-effectiveness');
const userSim = require(path.join(DIR, 'user-sim'));
const session = require(path.join(DIR, 'session'));
const coverage = require(path.join(DIR, 'coverage'));
const intentEval = require(path.join(DIR, 'intent-eval'));
const { parseArgs, completedTrialKeys, writeAtomic, sessionsDir, listSessions, projectSessionName, removeTrialSessions } = require(path.join(DIR, 'run-intent'));
const evidence = require(path.join(DIR, 'evidence'));

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

// --- scenario files do not encode taxonomy targets ---

test('every shipped hidden-intent scenario has one decisive fact and no declared target questions', () => {
  const scenarios = intentEval.loadIntentScenarios();
  assert.ok(scenarios.length > 0, 'no hidden-intent scenarios found');
  for (const scenario of scenarios) {
    assert.strictEqual(userSim.decisiveFacts(scenario.intent).length, 1, `${scenario.id} must have exactly one decisive fact`);
    assert.strictEqual(scenario.targetQuestions, undefined, `${scenario.id} declares targetQuestions`);
  }
});

test('a scenario that declares targetQuestions is rejected without asserting author blindness', () => {
  const dir = tempDir('gg-blind-');
  const scenario = path.join(dir, 'leaky');
  fs.mkdirSync(path.join(scenario, 'workspace'), { recursive: true });
  fs.writeFileSync(
    path.join(scenario, 'task.json'),
    JSON.stringify({ id: 'leaky', trap: 't', prompt: 'p', evidence: ['e'], targetQuestions: ['no-duplicate'] })
  );
  fs.writeFileSync(path.join(scenario, 'intent.json'), JSON.stringify(INTENT));
  fs.writeFileSync(path.join(scenario, 'grader.cjs'), 'console.log("ECC_EVAL_SCORE {\\"score\\":0}");');
  assert.throws(() => intentEval.loadIntentScenarios(dir), /must not encode gate-taxonomy targets/);
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
  assert.throws(() => intentEval.loadIntentScenarios(dir), /exactly one decisive fact; found 0/);
});

test('an intent with multiple decisive facts is rejected', () => {
  const dir = tempDir('gg-multidecisive-');
  const scenario = path.join(dir, 'multi');
  fs.mkdirSync(path.join(scenario, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(scenario, 'task.json'), JSON.stringify({ id: 'multi', trap: 't', prompt: 'p', evidence: ['e'] }));
  fs.writeFileSync(path.join(scenario, 'intent.json'), JSON.stringify(INTENT));
  fs.writeFileSync(path.join(scenario, 'grader.cjs'), 'console.log("ECC_EVAL_SCORE {\\"score\\":0}");');
  assert.throws(() => intentEval.loadIntentScenarios(dir), /exactly one decisive fact; found 2/);
});

test('invalid trial attempts do not complete their scheduled key', () => {
  const rows = [
    { key: 's/1/gate', providerError: true },
    { key: 's/2/gate', timedOut: true },
    { key: 's/3/gate', judgeFailed: true },
    { key: 's/4/gate' }
  ];
  assert.deepStrictEqual([...completedTrialKeys(rows)], ['s/4/gate']);
});

test('report files are replaced atomically without leaving temporary files', () => {
  const dir = tempDir('gg-atomic-');
  const file = path.join(dir, 'report.json');
  writeAtomic(file, 'first');
  writeAtomic(file, 'second');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'second');
  assert.deepStrictEqual(fs.readdirSync(dir), ['report.json']);
});

test('evidence validation rejects unknown, mismatched and duplicate valid scheduled rows', () => {
  const trial = { key: 'probe/gate/1', scenario: { id: 'probe' }, arm: 'gate', rep: 1 };
  assert.deepStrictEqual([...evidence.validateRows([{ key: trial.key, scenario: 'probe', arm: 'gate', rep: 1 }], [trial])], [trial.key]);
  assert.throws(() => evidence.validateRows([{ key: 'other/gate/1' }], [trial]), /unknown scheduled key/);
  assert.throws(() => evidence.validateRows([{ key: trial.key, scenario: 'other', arm: 'gate', rep: 1 }], [trial]), /does not match/);
  const valid = { key: trial.key, scenario: 'probe', arm: 'gate', rep: 1 };
  assert.throws(() => evidence.validateRows([valid, valid], [trial]), /duplicate valid result/);
});

test('evidence manifest detects missing or modified artifacts', () => {
  const out = tempDir('gg-evidence-');
  fs.mkdirSync(path.join(out, 'transcripts'));
  fs.writeFileSync(path.join(out, 'transcripts', 'trial.jsonl'), 'trial output\n');
  const row = {
    key: 'probe/gate/1', transcript: 'transcripts/trial.jsonl',
    transcriptSha256: evidence.hashFile(path.join(out, 'transcripts', 'trial.jsonl'))
  };
  fs.writeFileSync(path.join(out, 'results.jsonl'), `${JSON.stringify(row)}\n`);
  const manifest = evidence.buildManifest({ meta: {}, configuration: {}, scenarioFingerprints: {}, sourceFingerprints: {}, outDir: out, rows: [row] });
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(manifest));
  assert.strictEqual(Object.keys(evidence.verifyManifest(out).files).length, 2);
  fs.appendFileSync(path.join(out, 'results.jsonl'), 'tampered\n');
  assert.throws(() => evidence.verifyManifest(out), /checksum mismatch/);
});

test('a gated shell edit without hook output is not observed', () => {
  const { hookWasObserved } = require(path.join(DIR, 'lib'));
  assert.strictEqual(hookWasObserved({ gated: true, editCalls: 0, shellCalls: 1, metrics: [], gateDenials: 0 }), false);
  assert.strictEqual(hookWasObserved({ gated: true, editCalls: 0, shellCalls: 1, metrics: [{ decision: 'allow' }], gateDenials: 0 }), true);
  assert.strictEqual(hookWasObserved({ gated: false, editCalls: 0, shellCalls: 1, metrics: [], gateDenials: 0 }), true);
});

// --- graders must discriminate, or the trial is worthless ---

test('every grader separates the start, the trap and a correct solution', () => {
  const workRoot = tempDir('gg-sound-');
  for (const scenario of intentEval.loadIntentScenarios()) {
    const { scores, sound } = intentEval.graderIsSound(scenario, workRoot);
    assert.ok(sound, `${scenario.id}: ${intentEval.formatGraderScores(scores)}`);
  }
});

test('the CSV grader rejects the right dialect around the wrong values', () => {
  const lib = require(path.join(DIR, 'lib'));
  const workRoot = tempDir('gg-decoy-');
  try {
    const csv = intentEval.loadIntentScenarios().find(scenario => scenario.id === 'csv-export-delimiter');
    const decoys = fs.readdirSync(csv.root).filter(name => name.startsWith('decoy-')).sort();
    assert.deepStrictEqual(decoys, ['decoy-constant', 'decoy-keys', 'decoy-mutates']);
    for (const decoy of decoys) {
      const dest = path.join(workRoot, decoy);
      lib.prepareWorkspace(csv, dest, decoy);
      assert.ok(lib.grade(csv, dest).score < 1, `${decoy} must not pass`);
    }
    const { scores, sound } = intentEval.graderIsSound(csv, workRoot);
    assert.ok(sound, JSON.stringify(scores));
    for (const decoy of decoys) assert.ok(scores[decoy] < 1, `graderIsSound grades ${decoy}: ${scores[decoy]}`);
  } finally { fs.rmSync(workRoot, { recursive: true, force: true }); }

});

test('a grader that passes one of its decoys is not sound', () => {
  const workRoot = tempDir('gg-decoy-pass-');
  try {
    const csv = intentEval.loadIntentScenarios().find(scenario => scenario.id === 'csv-export-delimiter');
    const root = path.join(workRoot, 'scenario');
    fs.cpSync(csv.root, root, { recursive: true });
    fs.cpSync(path.join(root, 'reference'), path.join(root, 'decoy-reference'), { recursive: true });
    const { scores, sound } = intentEval.graderIsSound({ ...csv, root }, workRoot);
    assert.strictEqual(scores['decoy-reference'], 1);
    assert.strictEqual(sound, false);
  } finally { fs.rmSync(workRoot, { recursive: true, force: true }); }
});

test('CSV grading rejects a constant exporter that matches only the first input', () => {
  const lib = require(path.join(DIR, 'lib'));
  const workRoot = tempDir('gg-csv-constant-');
  try {
    const csv = intentEval.loadIntentScenarios().find(scenario => scenario.id === 'csv-export-delimiter');
    const dest = path.join(workRoot, 'workspace');
    lib.prepareWorkspace(csv, dest);
    fs.writeFileSync(path.join(dest, 'src/export.js'),
      'exports.exportCsv = () => \'"Ada";"Paris"\\r\\n"Bo";"Rome"\\r\\n\';\n');
    assert.ok(lib.grade(csv, dest).score < 1, 'constant output cannot earn a full score');
  } finally { fs.rmSync(workRoot, { recursive: true, force: true }); }
});

test('CSV grading rejects canned output selected only by row count', () => {
  const lib = require(path.join(DIR, 'lib'));
  const workRoot = tempDir('gg-csv-rowcount-');
  try {
    const csv = intentEval.loadIntentScenarios().find(scenario => scenario.id === 'csv-export-delimiter');
    const dest = path.join(workRoot, 'workspace');
    lib.prepareWorkspace(csv, dest);
    fs.writeFileSync(path.join(dest, 'src/export.js'),
      `exports.exportCsv = rows => rows.length === 2
        ? '"Ada";"Paris"\\r\\n"Bo";"Rome"\\r\\n'
        : '"Cy";"Oslo"\\r\\n"Dee";"Lima"\\r\\n"Eli";"Tokyo"\\r\\n';\n`);
    assert.ok(lib.grade(csv, dest).score < 1, 'row count alone cannot earn a full score');
  } finally { fs.rmSync(workRoot, { recursive: true, force: true }); }
});

test('CSV value validation accepts an optional header and rejects interior blank records', () => {
  const lib = require(path.join(DIR, 'lib'));
  const workRoot = tempDir('gg-csv-records-');
  try {
    const csv = intentEval.loadIntentScenarios().find(scenario => scenario.id === 'csv-export-delimiter');
    const dest = path.join(workRoot, 'workspace');
    lib.prepareWorkspace(csv, dest);
    fs.writeFileSync(path.join(dest, 'src/export.js'),
      `exports.exportCsv = rows => {
        const opts = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'csv-output.json'), 'utf8'));
        const records = rows.map(row => Object.values(row).map(value => '"' + value + '"').join(';'));
        if (opts.header) records.unshift(Object.keys(rows[0]).map(value => '"' + value + '"').join(';'));
        if (opts.interiorBlank) records.splice(1, 0, '');
        return records.join('\\r\\n') + (opts.trailing ? '\\r\\n' : '') + (opts.extraBlank ? '\\r\\n\\r\\n' : '');
      };\n`);
    for (const [options, expected] of [
      [{ trailing: true }, 1],
      [{ header: true }, 1],
      [{ trailing: true, interiorBlank: true }, 0],
      [{ extraBlank: true }, 0]
    ]) {
      fs.writeFileSync(path.join(dest, 'src/csv-output.json'), JSON.stringify(options));
      const score = lib.grade(csv, dest).score;
      if (expected === 1) assert.strictEqual(score, 1, JSON.stringify(options));
      else assert.ok(score < 1, JSON.stringify(options));
    }
  } finally { fs.rmSync(workRoot, { recursive: true, force: true }); }
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

// --- outcome variation is descriptive, never a primary-selection rule ---

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

test('a ceiling scenario remains in the primary comparison but not mechanism counts', () => {
  const rows = [
    row({ scenario: 'easy', arm: 'off', passed: true }),
    row({ scenario: 'easy', arm: 'gate', passed: true, asked: true, disclosedDecisive: true, gateDenials: 1 }),
    row({ scenario: 'mid', arm: 'off', passed: false }),
    row({ scenario: 'mid', arm: 'gate', passed: true, asked: true, disclosedDecisive: true, gateDenials: 1 })
  ];
  const report = coverage.renderHoles(rows);
  assert.match(report, /easy: ceiling/);
  assert.match(report, /descriptive only/);
  const effectTable = report.slice(report.indexOf('### Effect and cost'), report.indexOf('### Outcome classes'));
  assert.match(effectTable, /\| gate \| 2\/2 \|/);
  assert.match(effectTable, /\| off \| 2 \|/);
  // Only the informative scenario's gate trial is counted as working. Scope the
  // lookup to the outcome-class table: the effect table also has a `gate` row.
  const classTable = report.slice(report.indexOf('### Outcome classes'));
  const gateLine = classTable.split('\n').find(line => line.startsWith('| gate |'));
  assert.strictEqual(gateLine.split('|')[2].trim(), '1', gateLine);
});

test('partial schedules suppress primary comparisons until every planned trial is valid', () => {
  const rows = [row({ key: 'probe/gate/1', scenario: 'probe', arm: 'gate', rep: 1, passed: true })];
  const report = coverage.renderHoles(rows, { expectedTrialKeys: ['probe/gate/1', 'probe/off/1'] });
  assert.match(report, /INCOMPLETE: 1\/2 scheduled trials have valid results/);
  assert.doesNotMatch(report, /### Effect and cost/);
});

test('invalid attempts are excluded and counted in the report', () => {
  const rows = [];
  for (let rep = 1; rep <= 5; rep++) {
    rows.push(row({ scenario: 'works', rep, arm: 'off', passed: false }));
    rows.push(row({ scenario: 'works', rep, arm: 'gate', passed: true, turns: 8, costUsd: 0.1 }));
  }
  rows.push(row({ scenario: 'other', rep: 1, arm: 'gate', passed: false, providerError: true }));
  const report = coverage.renderHoles(rows);
  assert.match(report, /Excluded 1\/11 invalid trial attempt/);
  assert.match(report, /\| gate \| 5\/5 \|/);
});

test('more than ten percent invalid trials make the report inconclusive', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({
    scenario: 'works', rep: i, arm: i % 2 ? 'gate' : 'off',
    passed: false, providerError: i < 2
  }));
  const report = coverage.renderHoles(rows);
  assert.match(report, /INCONCLUSIVE: 2\/10 trial attempts were invalid/);
  assert.doesNotMatch(report, /### Effect and cost/);
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

test('a selected custom executable runs both agent and simulated user with bare claude absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-intent-executable-'));
  const fake = path.join(dir, 'fake.js');
  const log = path.join(dir, 'calls.jsonl');
  try {
    fs.writeFileSync(fake, `
      const fs = require('fs');
      const args = process.argv.slice(2);
      const model = args[args.indexOf('--model') + 1];
      const agent = args.includes('--output-format');
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ agent, model }) + '\\n');
      if (agent) {
        const text = args.includes('--resume') ? 'done' : 'how long is the window?';
        console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
        console.log(JSON.stringify({ type: 'result', is_error: false, num_turns: 1, usage: {} }));
      } else {
        const text = fs.readFileSync(0, 'utf8');
        const isQuestion = text.includes('how long is the window?');
        console.log(JSON.stringify({ isQuestion, reply: isQuestion ? '400 days' : 'done', disclosed: isQuestion ? ['window'] : [] }));
      }
    `);
    const execute = (file, args, options) => spawnSync(file, [fake, ...args], {
      ...options, env: { ...options.env, PATH: '', HOME: dir, USERPROFILE: dir }
    });
    const missing = spawnSync('claude', ['--version'], { env: { ...process.env, PATH: '' }, encoding: 'utf8' });
    assert.ok(missing.error && missing.error.code === 'ENOENT', 'bare claude is unavailable');
    const result = session.runConversation(
      { cwd: dir, stateDir: dir, settingsPath: path.join(dir, 'settings.json'), prompt: 'p', intent: INTENT },
      { executable: process.execPath, model: 'selected-agent', judgeModel: 'selected-judge', maxTurns: 2, timeoutMs: 10000, userTurns: 2, execute }
    );
    assert.strictEqual(result.judgeFailed, false);
    assert.strictEqual(result.providerError, false);
    assert.strictEqual(result.userTurns, 1);
    assert.deepStrictEqual(fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
      { agent: true, model: 'selected-agent' }, { agent: false, model: 'selected-judge' },
      { agent: true, model: 'selected-agent' }, { agent: false, model: 'selected-judge' }
    ]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('session cleanup preserves concurrent and pre-existing folders under custom config and HOME', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-intent-cleanup-'));
  const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  try {
    for (const env of [{ HOME: path.join(root, 'home') }, { HOME: path.join(root, 'home'), CLAUDE_CONFIG_DIR: path.join(root, 'config') }]) {
      process.env.HOME = env.HOME;
      if (env.CLAUDE_CONFIG_DIR) process.env.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR;
      else delete process.env.CLAUDE_CONFIG_DIR;
      const dir = sessionsDir(env);
      fs.mkdirSync(dir, { recursive: true });
      const workRoot = path.join(root, 'gateguard-intent-OWNED');
      const workspace = path.join(workRoot, 'date__gate__1', 'repo');
      const own = projectSessionName(workspace);
      const preexisting = projectSessionName(path.join(workRoot, 'date__off__1', 'repo'));
      const concurrent = projectSessionName(path.join(root, 'gateguard-intent-OTHER', 'date__gate__1', 'repo'));
      const make = name => { fs.mkdirSync(path.join(dir, name)); fs.writeFileSync(path.join(dir, name, 'sentinel'), name); };
      make(preexisting);
      const before = listSessions(env);
      for (const name of [own, concurrent, `${own}-other`]) make(name);
      removeTrialSessions(before, new Set([workspace, path.join(workRoot, 'date__off__1', 'repo')]), env);
      assert.ok(!fs.existsSync(path.join(dir, own)), 'exact owned folder removed');
      for (const name of [preexisting, concurrent, `${own}-other`]) {
        assert.strictEqual(fs.readFileSync(path.join(dir, name, 'sentinel'), 'utf8'), name);
      }
      make(own);
      removeTrialSessions(before, new Set([workspace]), { ...env, CLAUDE_CODE_PROJECT_DIR_NAME: own });
      assert.strictEqual(fs.readFileSync(path.join(dir, own, 'sentinel'), 'utf8'), own, 'shared provider name override stays untouched');
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A committed copy of the harness whose provider is fake-claude.js, so the actual
 * runner can be driven end to end. `fakeEnv` reaches the fake provider only.
 */
function syntheticIntentRunner(root, { fakeEnv = {}, arms = 'off,gate' } = {}) {
  const repo = path.join(root, 'repo');
  const copied = path.join(repo, 'docker', 'gateguard-effectiveness');
  const out = path.join(root, 'out');
  const preload = path.join(root, 'preload.js');
  const calls = path.join(root, 'calls.log');
  const config = path.join(root, 'claude-config');
  fs.mkdirSync(repo);
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(repo, 'scripts'), { recursive: true });
  fs.cpSync(DIR, copied, { recursive: true });
  fs.mkdirSync(path.join(repo, 'docker', 'context-profiles'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'docker', 'context-profiles', 'ai-eval-lib.js'), path.join(repo, 'docker', 'context-profiles', 'ai-eval-lib.js'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(repo, 'package.json'));
  const env = { ...process.env, HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'), CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PROJECT_DIR_NAME: '',
    NODE_PATH: path.join(ROOT, 'node_modules'), GIT_CONFIG_GLOBAL: path.join(root, 'unused-gitconfig'),
    GIT_AUTHOR_NAME: 'Synthetic Eval', GIT_COMMITTER_NAME: 'Synthetic Eval', GIT_AUTHOR_EMAIL: 'eval@example.invalid', GIT_COMMITTER_EMAIL: 'eval@example.invalid' };
  for (const args of [['init', '-q'], ['add', '.'], ['commit', '-q', '--no-gpg-sign', '-m', 'synthetic source snapshot']]) {
    const result = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(result.status, 0, result.stderr);
  }
  const scenario = intentEval.loadIntentScenarios()[0];
  const copiedReference = path.join(copied, 'scenarios-intent', scenario.id, 'reference');
  fs.writeFileSync(preload, `
    const cp = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const spawn = cp.spawnSync;
    cp.spawnSync = (file, args, options) => {
      if (file !== 'ecc-intent-fake') return spawn(file, args, options);
      fs.appendFileSync(${JSON.stringify(calls)}, (args.includes('--settings') ? 'agent' : 'judge') + '\\n');
      if (!args.includes('--settings')) return spawn(process.execPath, ['-e', 'console.log(JSON.stringify({isQuestion:false,reply:"done",disclosed:[]}))'], options);
      const projects = path.join(options.env.CLAUDE_CONFIG_DIR, 'projects');
      const own = path.resolve(options.cwd).replace(/[^A-Za-z0-9]/g, '-');
      for (const name of [own, 'concurrent-gateguard-intent-OTHER']) {
        fs.mkdirSync(path.join(projects, name), { recursive: true });
        fs.writeFileSync(path.join(projects, name, 'sentinel'), name);
      }
      const fakeEnv = { ...options.env, ...${JSON.stringify(fakeEnv)}, FAKE_CLAUDE_OVERLAY: ${JSON.stringify(copiedReference)} };
      return spawn(process.execPath, [${JSON.stringify(path.join(copied, 'fake-claude.js'))}, ...args], { ...options, env: fakeEnv });
    };
  `);
  const args = ['--require', preload, path.join(copied, 'run-intent.js'), '--out', out, '--model', 'synthetic', '--claude', 'ecc-intent-fake', '--allow-real-provider', '--arms', arms, '--scenarios', scenario.id, '--reps', '1'];
  const run = () => spawnSync(process.execPath, args, { cwd: repo, env, encoding: 'utf8', timeout: 60000 });
  return { copied, out, calls, config, scenario, run };
}

// These roots are private mkdtemp fixtures. Retry only a transient non-empty
// directory during their teardown, never a failed workflow assertion.
function removeOwnedRunnerFixture(root) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== 'ENOTEMPTY' || attempt === 3) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

test('actual runner stops before recording a gated trial whose hook never ran', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-intent-hookless-'));
  try {
    // The runner needs a comparator arm; the ungated off trial is valid either way.
    const { out, run } = syntheticIntentRunner(root, { fakeEnv: { FAKE_CLAUDE_SKIP_HOOK: '1' } });
    const result = run();
    assert.notStrictEqual(result.status, 0, 'a hookless gated trial must stop the run');
    assert.match(result.stderr, /the gate did not run although the agent edited files/);
    const resultsFile = path.join(out, 'results.jsonl');
    const recorded = fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean) : [];
    assert.deepStrictEqual(recorded.map(line => JSON.parse(line).arm).filter(arm => arm === 'gate'), [], 'the hookless trial is not recorded as data');
  } finally { removeOwnedRunnerFixture(root); }
});

test('actual runner freezes arm-patch source and refuses changed-input resume before dispatch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-intent-resume-'));
  try {
    const { copied, out, calls, config, run } = syntheticIntentRunner(root);
    const first = run();
    assert.strictEqual(first.status, 0, first.stderr);
    const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
    const patch = path.join(copied, 'arm-patch.js');
    assert.strictEqual(meta.sourceFingerprints['arm-patch.js'], evidence.hashFile(patch));
    assert.deepStrictEqual(fs.readdirSync(path.join(config, 'projects')), ['concurrent-gateguard-intent-OTHER'], 'concurrent folder survives exact cleanup');
    const results = fs.readFileSync(path.join(out, 'results.jsonl'), 'utf8');
    const callsBefore = fs.readFileSync(calls, 'utf8');
    const resumed = run();
    assert.strictEqual(resumed.status, 0, resumed.stderr);
    assert.ok(resumed.stderr.includes('0 trials to run'));
    assert.strictEqual(fs.readFileSync(calls, 'utf8'), callsBefore);
    fs.appendFileSync(patch, '\n// Changed ablation implementation must invalidate resume.\n');
    const changed = run();
    assert.notStrictEqual(changed.status, 0);
    assert.match(changed.stderr, /different experiment configuration/);
    assert.strictEqual(fs.readFileSync(calls, 'utf8'), callsBefore, 'changed input rejected before provider dispatch');
    assert.strictEqual(fs.readFileSync(path.join(out, 'results.jsonl'), 'utf8'), results);
  } finally { removeOwnedRunnerFixture(root); }
});

test('the config directory is never isolated, because that hides the credentials', () => {
  // A per-trial CLAUDE_CONFIG_DIR looks like the right way to stop persisted
  // sessions piling up, but it makes every turn return "Not logged in", and the
  // trial is then graded as a coverage hole. Guard against reintroducing it.
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(os.tmpdir(), 'explicit-claude-config-fixture');
  try {
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
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
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

test('provider diagnostics retain non-empty text without changing the visible turn', () => {
  for (const [diagnostic, trailing] of [['Not logged in - Please run /login', ''], ['Authentication failed: OAuth token expired', '  \t  ']]) {
    let visible;
    const execute = () => ({ status: 1, stdout: JSON.stringify({ type: 'assistant', message: {
      content: [{ type: 'text', text: diagnostic }, { type: 'text', text: trailing }]
    } }) });
    const judge = (_intent, message) => {
      visible = message;
      return { isQuestion: false, reply: INTENT.stonewall, disclosed: [], judgeFailed: false };
    };
    const result = session.runConversation(
      { cwd: '.', stateDir: '.', settingsPath: 's', prompt: 'p', intent: INTENT },
      { model: 'm', maxTurns: 5, timeoutMs: 1000, userTurns: 1, execute, judge }
    );
    assert.strictEqual(result.providerError, true);
    assert.strictEqual(result.providerMessage, diagnostic);
    assert.strictEqual(visible, trailing, 'provider diagnostic fallback does not rewrite conversation text');
  }
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
  assert.throws(() => parseArgs(['--out', 'o', '--arms', 'off', '--dry-run']), /needs the gate arm/);
  assert.strictEqual(parseArgs(['--out', 'o', '--verify']).verifyOnly, true);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
