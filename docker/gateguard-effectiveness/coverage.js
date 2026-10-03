'use strict';

// Hole finding.
//
// The first evaluation asserted that the gate asks each scenario's declared
// targetQuestions. Those targets were chosen by reading the gate's own
// taxonomy, so the check passed by construction and could never find a missing
// question. Nothing here reads the taxonomy. Every class below is computed from
// what the trial *did*: whether the gate fired, whether the agent asked the
// user, whether the deciding fact came out, and whether the outcome was right.
//
// The questions a scenario provokes are therefore discovered and reported, not
// declared and asserted.

const { wilson } = require('../context-profiles/ai-eval-lib');
const { pairedComparison } = require('./lib');

// Rough floor for 80% power on a 40-point pass-rate difference at a two-sided
// 5% level. Below it the report refuses to let counts stand as evidence.
const MIN_PAIRS_FOR_A_CLAIM = 20;

/** Outcome classes. The four ending in -hole are the improvable cases. */
const CLASSES = Object.freeze({
  working: 'the deciding fact was obtained and the outcome is right',
  lucky: 'right outcome without ever asking: the scenario does not force the question',
  'unaided-miss': 'an ungated arm missed: the baseline rate, not a gate hole',
  'follow-through-hole': 'the deciding fact was obtained and the outcome is still wrong',
  'targeting-hole': 'the agent asked, but not for the deciding fact',
  'silence-hole': 'the gate fired and the agent still did not ask',
  'coverage-hole': 'a deciding ambiguity the gate never engaged, and the outcome is wrong'
});

/**
 * Classifies one trial from its behaviour alone.
 *
 * silence-hole and coverage-hole are statements about the gate, so they are only
 * reachable for a gated arm. An ungated arm never fires the gate, so without
 * this it would have every miss labelled coverage-hole by construction, which
 * padded the hole counts with rows that say nothing about the gate.
 */
function classify(row) {
  const gated = row.gated === undefined ? row.arm !== 'off' : row.gated;
  const gateFired = Number(row.gateDenials) > 0;
  if (row.disclosedDecisive) return row.passed ? 'working' : 'follow-through-hole';
  if (row.asked) return 'targeting-hole';
  if (row.passed) return 'lucky';
  if (!gated) return 'unaided-miss';
  return gateFired ? 'silence-hole' : 'coverage-hole';
}

function tally(rows) {
  const counts = {};
  for (const key of Object.keys(CLASSES)) counts[key] = 0;
  for (const row of rows) counts[classify(row)]++;
  return counts;
}

/**
 * Trap strength: how often the ungated arm passes.
 *
 * A trap the ungated arm always beats is not a trap. This is reported for its
 * own sake and does NOT decide whether a scenario is usable, because the
 * ungated arm failing is what a working trap looks like.
 */
function difficulty(rows, { baselineArm = 'off' } = {}) {
  const byScenario = {};
  for (const row of rows.filter(row => row.arm === baselineArm)) {
    (byScenario[row.scenario] ||= []).push(row);
  }
  return Object.entries(byScenario)
    .map(([scenario, rs]) => {
      const passed = rs.filter(row => row.passed).length;
      const rate = passed / rs.length;
      return { scenario, n: rs.length, passed, rate, label: rate === 1 ? 'ceiling' : 'traps' };
    })
    .sort((a, b) => a.scenario.localeCompare(b.scenario));
}

/**
 * Whether a scenario separates any arm from any other, judged across every arm.
 *
 * Only a scenario where nothing varies is uninformative: every trial passing
 * (the trap does not bite) or every trial failing (nothing reaches it). Judging
 * this from the ungated arm alone would discard exactly the scenarios that
 * work, since there the ungated arm is meant to fail.
 */
function informative(rows) {
  const byScenario = {};
  for (const row of rows) (byScenario[row.scenario] ||= []).push(row);
  return Object.entries(byScenario)
    .map(([scenario, rs]) => {
      const passed = rs.filter(row => row.passed).length;
      const label = passed === rs.length ? 'ceiling' : passed === 0 ? 'floor' : 'informative';
      return { scenario, n: rs.length, passed, label };
    })
    .sort((a, b) => a.scenario.localeCompare(b.scenario));
}

/** Questions the gate actually raised per scenario, discovered from the runs. */
function discoveredQuestions(rows) {
  const byScenario = {};
  for (const row of rows) {
    const set = (byScenario[row.scenario] ||= new Set());
    for (const question of row.questionsAsked || []) set.add(question);
  }
  return Object.entries(byScenario)
    .map(([scenario, set]) => ({ scenario, questions: [...set].sort() }))
    .sort((a, b) => a.scenario.localeCompare(b.scenario));
}

/**
 * Scenarios where the gate asked nothing at all, across every gated arm.
 * These are the strongest candidates for a missing question.
 */
function unengaged(rows, { baselineArm = 'off' } = {}) {
  const gated = rows.filter(row => row.arm !== baselineArm);
  const byScenario = {};
  for (const row of gated) {
    const entry = (byScenario[row.scenario] ||= { fired: 0, n: 0 });
    entry.n++;
    if (Number(row.gateDenials) > 0) entry.fired++;
  }
  return Object.entries(byScenario)
    .filter(([, entry]) => entry.fired === 0)
    .map(([scenario]) => scenario)
    .sort();
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

/**
 * Effect size and cost, with intervals and an exact paired test.
 *
 * The hole classes say what went wrong; they say nothing about whether the
 * difference between arms is distinguishable from chance. Bare counts read as
 * evidence, so the interval and the McNemar p-value are printed beside them,
 * and a run too small to support any claim says so in words.
 */
function renderEffect(rows, { referenceArm = 'gate', baselineArm = 'off' } = {}) {
  const arms = [...new Set(rows.map(row => row.arm))].sort();
  const lines = ['### Effect and cost', ''];
  lines.push('| Arm | Passed | Wilson 95% | Mean turns | Mean cost (USD) |', '| --- | ---: | --- | ---: | ---: |');
  for (const arm of arms) {
    const own = rows.filter(row => row.arm === arm);
    if (!own.length) continue;
    const passes = own.filter(row => row.passed).length;
    const [low, high] = wilson(passes, own.length);
    const mean = key => own.reduce((total, row) => total + (Number(row[key]) || 0), 0) / own.length;
    lines.push(`| ${arm} | ${passes}/${own.length} | ${pct(low)}-${pct(high)} | ${mean('turns').toFixed(1)} | ${mean('costUsd').toFixed(3)} |`);
  }

  lines.push('', `| Arm vs ${referenceArm} | Pairs | Pass-rate difference (95%) | ${referenceArm} only | Arm only | McNemar p |`);
  lines.push('| --- | ---: | --- | ---: | ---: | ---: |');
  let smallest = Infinity;
  for (const arm of arms.filter(arm => arm !== referenceArm)) {
    const cmp = pairedComparison(rows, referenceArm, arm);
    smallest = Math.min(smallest, cmp.pairs);
    const [low, high] = cmp.interval;
    lines.push(
      `| ${arm} | ${cmp.pairs} | ${pct(cmp.passRateDifference)} (${pct(low)} to ${pct(high)}) | ${cmp.onlyReference} | ${cmp.onlyArm} | ${cmp.mcnemarP.toFixed(3)} |`
    );
  }

  // 20 trials per arm is the rough floor for 80% power on a 40-point difference
  // at a two-sided 5% level; a run near this one's size separates nothing.
  if (Number.isFinite(smallest) && smallest < MIN_PAIRS_FOR_A_CLAIM) {
    lines.push(
      '',
      `Underpowered: ${smallest} pair(s) against \`${referenceArm}\`. At 80% power and a two-sided 5% level, ` +
        'about 20 trials per arm are needed to detect a 40-point pass-rate difference, about 36 for 30 points, ' +
        'and about 160 for the 15-point threshold the pilot pre-registered. Read the rows above as a ' +
        `demonstration that the arms can differ at all, not as evidence that \`${referenceArm}\` beats \`${baselineArm}\`.`
    );
  }
  return `${lines.join('\n')}\n`;
}

function renderHoles(rows, { baselineArm = 'off' } = {}) {
  const arms = [...new Set(rows.map(row => row.arm))].sort();
  const classes = Object.keys(CLASSES);
  const lines = [];

  const strength = difficulty(rows, { baselineArm });
  const verdicts = informative(rows);

  lines.push('### Trap strength and usability', '');
  lines.push('| Scenario | Ungated passed | Rate | Trap | Separates arms |', '| --- | ---: | ---: | --- | --- |');
  const verdictOf = Object.fromEntries(verdicts.map(row => [row.scenario, row.label]));
  for (const row of strength) {
    lines.push(`| ${row.scenario} | ${row.passed}/${row.n} | ${pct(row.rate)} | ${row.label} | ${verdictOf[row.scenario]} |`);
  }
  const dead = verdicts.filter(row => row.label !== 'informative');
  lines.push('');
  lines.push(
    dead.length
      ? `${dead.length} of ${verdicts.length} scenarios carry no information (${dead.map(row => `${row.scenario}: ${row.label}`).join('; ')}). Arm comparisons below exclude them.`
      : `All ${verdicts.length} scenarios separate at least one arm from another.`
  );

  const usableScenarios = new Set(verdicts.filter(row => row.label === 'informative').map(row => row.scenario));
  const usable = rows.filter(row => usableScenarios.has(row.scenario));

  lines.push('', renderEffect(usable.length ? usable : rows, { baselineArm }).trimEnd());

  lines.push('', '### Outcome classes', '');
  lines.push(`| Arm | ${classes.join(' | ')} |`, `| --- | ${classes.map(() => '---:').join(' | ')} |`);
  for (const arm of arms) {
    const counts = tally(usable.filter(row => row.arm === arm));
    lines.push(`| ${arm} | ${classes.map(key => counts[key]).join(' | ')} |`);
  }

  lines.push('', '### Holes to work on', '');
  const holes = classes.filter(key => key.endsWith('-hole'));
  const totals = tally(usable);
  const present = holes.filter(key => totals[key] > 0);
  if (!present.length) {
    lines.push('No holes on the informative scenarios in this run.');
  } else {
    for (const key of present) lines.push(`- **${key}** (${totals[key]}): ${CLASSES[key]}`);
  }

  const missing = unengaged(rows, { baselineArm });
  if (missing.length) {
    lines.push('', `Gate never fired on: ${missing.join(', ')} — candidates for a question the taxonomy lacks.`);
  }

  lines.push('', '### Questions the gate actually raised', '');
  lines.push('| Scenario | Observed questions |', '| --- | --- |');
  for (const row of discoveredQuestions(rows)) {
    lines.push(`| ${row.scenario} | ${row.questions.length ? row.questions.join(', ') : '_none_'} |`);
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  CLASSES, MIN_PAIRS_FOR_A_CLAIM, classify, tally, difficulty, informative,
  discoveredQuestions, unengaged, renderEffect, renderHoles
};
