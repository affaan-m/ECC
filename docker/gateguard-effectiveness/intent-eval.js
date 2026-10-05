'use strict';

// Loader and trial runner for hidden-intent scenarios.
//
// Deliberately absent from task.json: targetQuestions. The first generation of
// scenarios declared which question the gate ought to raise, chosen by reading
// the gate's own taxonomy, and the suite then asserted the gate raised it. That
// is a tautology, so it never found a missing question. Here the scenario
// declares only the trap and the user's hidden intent; which questions fire is
// observed from the run and classified in coverage.js.

const fs = require('fs');
const path = require('path');
const { prepareWorkspace, commitWorkspace, grade, readMetrics, hookWasObserved } = require('./lib');
const { ARMS, TRIAL_FILE, trialPatch } = require('./arms');
const { runConversation } = require('./session');
const { classify } = require('./coverage');

const SCENARIO_DIR = path.join(__dirname, 'scenarios-intent');

// minus-target needs declared target questions, which these scenarios do not have.
const SUPPORTED_ARMS = Object.freeze(['off', 'gate', 'placebo', 'main']);

function loadIntentScenarios(dir = SCENARIO_DIR, ids = null) {
  const scenarios = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const root = path.join(dir, entry.name);
      const spec = JSON.parse(fs.readFileSync(path.join(root, 'task.json'), 'utf8'));
      const intent = JSON.parse(fs.readFileSync(path.join(root, 'intent.json'), 'utf8'));
      if (spec.id !== entry.name) throw new Error(`scenario ${entry.name} declares id ${spec.id}`);
      if (spec.targetQuestions) {
        throw new Error(`scenario ${spec.id} declares targetQuestions; hidden-intent scenarios must not encode gate-taxonomy targets`);
      }
      for (const key of ['trap', 'prompt']) {
        if (typeof spec[key] !== 'string' || !spec[key]) throw new Error(`scenario ${spec.id} is missing ${key}`);
      }
      if (!Array.isArray(spec.evidence) || !spec.evidence.length) throw new Error(`scenario ${spec.id} has no evidence`);
      if (typeof intent.ambiguity !== 'string' || !intent.ambiguity) throw new Error(`scenario ${spec.id} intent has no ambiguity`);
      if (typeof intent.stonewall !== 'string' || !intent.stonewall) throw new Error(`scenario ${spec.id} intent has no stonewall`);
      if (!Array.isArray(intent.facts)) throw new Error(`scenario ${spec.id} intent has no decisive fact`);
      for (const fact of intent.facts) {
        if (!fact.id || typeof fact.fact !== 'string' || !fact.fact) throw new Error(`scenario ${spec.id} has a malformed fact`);
      }
      const decisiveCount = intent.facts.filter(fact => fact.decisive === true).length;
      if (decisiveCount !== 1) {
        throw new Error(`scenario ${spec.id} intent must have exactly one decisive fact; found ${decisiveCount}`);
      }
      return {
        ...spec,
        root,
        intent,
        evidence: spec.evidence.map(source => new RegExp(source, 'i')),
        grader: fs.readFileSync(path.join(root, 'grader.cjs'), 'utf8')
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!ids) return scenarios;
  const unknown = ids.filter(id => !scenarios.some(scenario => scenario.id === id));
  if (unknown.length) throw new Error(`unknown scenario: ${unknown.join(', ')}`);
  return scenarios.filter(scenario => ids.includes(scenario.id));
}

/** Confirms the grader separates the start, the trap and a correct solution. */
function graderIsSound(scenario, workRoot) {
  const scores = {};
  for (const variant of ['workspace', 'reference', 'naive']) {
    const dest = path.join(workRoot, `check-${scenario.id}-${variant}`);
    fs.rmSync(dest, { recursive: true, force: true });
    prepareWorkspace(scenario, dest, variant === 'workspace' ? null : variant);
    scores[variant] = grade(scenario, dest).score;
  }
  return { scores, sound: scores.reference === 1 && scores.workspace < 1 && scores.naive < 1 };
}

/** One trial: fresh workspace, a conversation with the simulated user, then the hidden grader. */
function runIntentTrial(trial, { workRoot, armSettingsByName, executable, model, judgeModel, maxTurns, timeoutMs, userTurns, execute, judge }) {
  if (!SUPPORTED_ARMS.includes(trial.arm)) throw new Error(`arm ${trial.arm} is not supported for hidden-intent scenarios`);
  const dir = path.join(workRoot, trial.key.replace(/\//g, '__'));
  fs.rmSync(dir, { recursive: true, force: true });
  const cwd = prepareWorkspace(trial.scenario, path.join(dir, 'repo'));
  const git = commitWorkspace(cwd);
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, `${JSON.stringify(armSettingsByName[trial.arm], null, 2)}\n`);
  fs.writeFileSync(path.join(dir, TRIAL_FILE), `${JSON.stringify({ stateDir, patch: trialPatch(trial.arm, trial.scenario) })}\n`);

  const conversation = runConversation(
    { cwd, stateDir, settingsPath, prompt: trial.scenario.prompt, intent: trial.scenario.intent },
    { executable, model, judgeModel, maxTurns, timeoutMs, userTurns, execute, judge }
  );
  const metrics = readMetrics(stateDir);
  const denials = metrics.filter(event => event.decision === 'deny' || event.decision === 'routine-deny');
  const outcome = grade(trial.scenario, cwd);

  const row = {
    key: trial.key,
    scenario: trial.scenario.id,
    arm: trial.arm,
    rep: trial.rep,
    git,
    gated: ARMS[trial.arm].gate,
    passed: outcome.passed,
    score: outcome.score,
    asked: conversation.asked,
    userTurns: conversation.userTurns,
    disclosed: conversation.disclosed,
    disclosedDecisive: conversation.disclosedDecisive,
    judgeFailed: conversation.judgeFailed,
    providerError: conversation.providerError,
    providerMessage: conversation.providerMessage,
    // Any hook-matched edit or shell call requires observable hook output.
    hookObserved: hookWasObserved({
      gated: ARMS[trial.arm].gate,
      editCalls: conversation.editCalls,
      shellCalls: conversation.shellCalls,
      metrics,
      gateDenials: conversation.gateDenials
    }),
    gateDenials: conversation.gateDenials,
    denialsPerTurn: conversation.denialsPerTurn,
    questionsAsked: [...new Set(denials.flatMap(event => event.questions || []))].sort(),
    editCalls: conversation.editCalls,
    tools: conversation.tools,
    exitStatus: conversation.exitStatus,
    timedOut: conversation.timedOut,
    inputTokens: conversation.inputTokens,
    cachedInputTokens: conversation.cachedInputTokens,
    outputTokens: conversation.outputTokens,
    costUsd: conversation.costUsd,
    turns: conversation.turns,
    durationMs: conversation.durationMs,
    exchange: conversation.exchange
  };
  row.outcomeClass = classify(row);
  return row;
}

module.exports = { loadIntentScenarios, graderIsSound, runIntentTrial, SCENARIO_DIR, SUPPORTED_ARMS };
