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

/** Outcome classes. The four ending in -hole are the improvable cases. */
const CLASSES = Object.freeze({
  working: 'the deciding fact was obtained and the outcome is right',
  lucky: 'right outcome without ever asking: the scenario does not force the question',
  'follow-through-hole': 'the deciding fact was obtained and the outcome is still wrong',
  'targeting-hole': 'the agent asked, but not for the deciding fact',
  'silence-hole': 'the gate fired and the agent still did not ask',
  'coverage-hole': 'a deciding ambiguity the gate never engaged, and the outcome is wrong'
});

/** Classifies one trial from its behaviour alone. */
function classify(row) {
  const gateFired = Number(row.gateDenials) > 0;
  if (row.disclosedDecisive) return row.passed ? 'working' : 'follow-through-hole';
  if (row.asked) return 'targeting-hole';
  if (row.passed) return 'lucky';
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

module.exports = { CLASSES, classify, tally, difficulty, informative, discoveredQuestions, unengaged, renderHoles };
