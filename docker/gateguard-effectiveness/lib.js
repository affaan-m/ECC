'use strict';

// Development-only evaluator; it lives under docker/ so the npm package never ships it.
// see docs/gateguard/question-effectiveness.md
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runScoredCheck, wilson } = require('../context-profiles/ai-eval-lib');
const { ARMS, TRIAL_FILE, trialPatch } = require('./arms');

const SCENARIO_DIR = path.join(__dirname, 'scenarios');
const DOT_PREFIX = 'dot-';
const AUTONOMY_NOTE = 'Work autonomously in this repository and do not ask clarifying questions.';
const PASSTHROUGH_ENV = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH']);
const SCRUBBED_ENV = /^(CLAUDE_|ECC_|GATEGUARD_)/;

// --- scenarios ---

function loadScenarios(dir = SCENARIO_DIR, ids = null) {
  const scenarios = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const root = path.join(dir, entry.name);
      const spec = JSON.parse(fs.readFileSync(path.join(root, 'task.json'), 'utf8'));
      if (spec.id !== entry.name) throw new Error(`scenario ${entry.name} declares id ${spec.id}`);
      for (const key of ['question', 'trap', 'prompt']) {
        if (typeof spec[key] !== 'string' || !spec[key]) throw new Error(`scenario ${spec.id} is missing ${key}`);
      }
      for (const key of ['evidence', 'targetQuestions']) {
        if (!Array.isArray(spec[key]) || spec[key].length === 0) throw new Error(`scenario ${spec.id} has no ${key}`);
      }
      return {
        ...spec,
        root,
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

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const name = entry.name.startsWith(DOT_PREFIX) ? `.${entry.name.slice(DOT_PREFIX.length)}` : entry.name;
    const source = path.join(from, entry.name);
    const target = path.join(to, name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyTree(source, target);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}

/** Writes a scenario's starting workspace into dest, optionally with its reference or naive overlay. */
function prepareWorkspace(scenario, dest, overlay = null) {
  fs.mkdirSync(dest, { recursive: true });
  copyTree(path.join(scenario.root, 'workspace'), dest);
  if (overlay) copyTree(path.join(scenario.root, overlay), dest);
  return dest;
}

/** Commits the starting workspace so `git status` and `git diff` work as in a real checkout. */
function commitWorkspace(cwd) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'eval', GIT_AUTHOR_EMAIL: 'eval@example.invalid', GIT_COMMITTER_NAME: 'eval', GIT_COMMITTER_EMAIL: 'eval@example.invalid' };
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '--no-gpg-sign', '-m', 'start']]) {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', shell: false, timeout: 30000 });
    if (result.status !== 0 || result.error) return false;
  }
  return true;
}

/** Graders always exit 0 and print a score; only a full score passes, and a crashed grader scores 0. */
function grade(scenario, cwd) {
  const { passed, score } = runScoredCheck(cwd, scenario.grader, 20000);
  return { passed: passed && score === 1, score: passed ? score : 0 };
}

function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(file, base, out);
    else if (entry.isFile()) out.push(path.relative(base, file));
  }
  return out.sort();
}

function changedHunk(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { old_string: a.slice(head, a.length - tail).join('\n'), new_string: b.slice(head, b.length - tail).join('\n') };
}

/** Questions a gate asks for the first edit of every file the reference solution changes. */
function questionsForReference(scenario, hookFile) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(require('os').tmpdir(), 'gg-route-')));
  const stateDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gg-route-state-'));
  const saved = { GATEGUARD_STATE_DIR: process.env.GATEGUARD_STATE_DIR, GATEGUARD_METRICS: process.env.GATEGUARD_METRICS, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR };
  try {
    prepareWorkspace(scenario, workspace);
    Object.assign(process.env, { GATEGUARD_STATE_DIR: stateDir, GATEGUARD_METRICS: '1', CLAUDE_PROJECT_DIR: workspace });
    const hookDir = path.dirname(path.dirname(hookFile));
    for (const key of Object.keys(require.cache)) if (key.startsWith(hookDir)) delete require.cache[key];
    const hook = require(hookFile);
    const reference = path.join(scenario.root, 'reference');
    for (const relative of listFiles(reference)) {
      const target = path.join(workspace, ...relative.split(path.sep).map(part => (part.startsWith(DOT_PREFIX) ? `.${part.slice(DOT_PREFIX.length)}` : part)));
      const next = fs.readFileSync(path.join(reference, relative), 'utf8');
      const call = fs.existsSync(target)
        ? { tool_name: 'Edit', tool_input: { file_path: target, ...changedHunk(fs.readFileSync(target, 'utf8'), next) } }
        : { tool_name: 'Write', tool_input: { file_path: target, content: next } };
      hook.run(JSON.stringify({ session_id: `route-${scenario.id}`, cwd: workspace, hook_event_name: 'PreToolUse', ...call }));
    }
    return readMetrics(stateDir).map(event => ({ cls: event.class, decision: event.decision, questions: event.questions || [] }));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

// --- trials ---

function xorshift(seed) {
  let state = seed >>> 0 || 1;
  return n => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return Math.floor((state / 4294967296) * n);
  };
}

/** Every (rep, scenario, arm) trial; arms run in a shuffled order inside each rep and scenario. */
function schedule(scenarios, arms, reps, seed = 11) {
  const random = xorshift(seed);
  const trials = [];
  for (let rep = 1; rep <= reps; rep++) {
    for (const scenario of scenarios) {
      const order = arms.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const arm of order) trials.push({ key: `${scenario.id}/${arm}/${rep}`, scenario, arm, rep });
    }
  }
  return trials;
}

function childEnv(stateDir) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!SCRUBBED_ENV.test(key) || PASSTHROUGH_ENV.has(key)) env[key] = value;
  }
  env.GATEGUARD_STATE_DIR = stateDir;
  env.GATEGUARD_METRICS = '1';
  env.DISABLE_NON_ESSENTIAL_MODEL_CALLS = '1';
  return env;
}

function claudeArgs({ model, settingsPath, maxTurns }) {
  return [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--permission-mode', 'bypassPermissions',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--settings', settingsPath,
    '--max-turns', String(maxTurns),
    '--model', model
  ];
}

const GATE_MARKER = /\[Fact-Forcing Gate\]/;

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => (block && typeof block.text === 'string' ? block.text : '')).join('\n');
}

/** Reads a stream-json transcript: final result, assistant text and tool calls. */
function parseStream(stdout) {
  const parsed = { result: null, texts: [], tools: {}, editCalls: 0, shellCalls: 0, gateDenials: 0 };
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (event && event.type === 'result') parsed.result = event;
    if (event && event.type === 'user' && event.message && Array.isArray(event.message.content)) {
      for (const block of event.message.content) {
        if (block && block.type === 'tool_result' && GATE_MARKER.test(toolResultText(block.content))) parsed.gateDenials++;
      }
    }
    const content = event && event.type === 'assistant' && event.message && Array.isArray(event.message.content) ? event.message.content : [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') parsed.texts.push(block.text);
      if (block.type === 'tool_use') {
        parsed.tools[block.name] = (parsed.tools[block.name] || 0) + 1;
        if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(block.name)) parsed.editCalls++;
        if (['Bash', 'PowerShell'].includes(block.name)) parsed.shellCalls++;
      }
    }
  }
  return parsed;
}

function readMetrics(stateDir) {
  const file = path.join(stateDir, 'metrics.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function hookWasObserved({ gated, editCalls, shellCalls, metrics, gateDenials }) {
  return !gated || editCalls + shellCalls === 0 || metrics.length > 0 || gateDenials > 0;
}

/** Share of a scenario's evidence patterns that the agent's own text states. */
function evidenceRecall(scenario, texts) {
  const text = texts.join('\n');
  return scenario.evidence.filter(pattern => pattern.test(text)).length / scenario.evidence.length;
}

function usageOf(result) {
  const u = (result && result.usage) || {};
  const n = value => (Number.isFinite(value) ? value : 0);
  return {
    inputTokens: n(u.input_tokens) + n(u.cache_creation_input_tokens),
    cachedInputTokens: n(u.cache_read_input_tokens),
    outputTokens: n(u.output_tokens),
    costUsd: result && Number.isFinite(result.total_cost_usd) ? result.total_cost_usd : null,
    turns: result && Number.isFinite(result.num_turns) ? result.num_turns : null,
    durationMs: result && Number.isFinite(result.duration_ms) ? result.duration_ms : null,
    models: result && result.modelUsage ? Object.keys(result.modelUsage) : []
  };
}

/** One trial: fresh workspace and state, one headless session, then the hidden grader. */
function runTrial(trial, { workRoot, armSettingsByName, executable, model, maxTurns, timeoutMs, execute = spawnSync }) {
  const dir = path.join(workRoot, trial.key.replace(/\//g, '__'));
  fs.rmSync(dir, { recursive: true, force: true });
  const cwd = prepareWorkspace(trial.scenario, path.join(dir, 'repo'));
  const git = commitWorkspace(cwd);
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, `${JSON.stringify(armSettingsByName[trial.arm], null, 2)}\n`);
  fs.writeFileSync(path.join(dir, TRIAL_FILE), `${JSON.stringify({ stateDir, patch: trialPatch(trial.arm, trial.scenario) })}\n`);
  const started = Date.now();
  const run = execute(executable, claudeArgs({ model, settingsPath, maxTurns }), {
    cwd,
    env: childEnv(stateDir),
    input: `${trial.scenario.prompt}\n\n${AUTONOMY_NOTE}\n`,
    encoding: 'utf8',
    shell: false,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024
  });
  const stream = parseStream(run.stdout);
  const metrics = readMetrics(stateDir);
  const outcome = grade(trial.scenario, cwd);
  const gated = ARMS[trial.arm].gate;
  const denials = metrics.filter(event => event.decision === 'deny' || event.decision === 'routine-deny');
  return {
    key: trial.key,
    scenario: trial.scenario.id,
    question: trial.scenario.question,
    arm: trial.arm,
    rep: trial.rep,
    git,
    exitStatus: run.status,
    timedOut: Boolean(run.error && run.error.code === 'ETIMEDOUT'),
    providerError: !stream.result || stream.result.is_error === true,
    providerMessage: stream.result && stream.result.is_error === true ? String(stream.result.result || '').slice(0, 200) : null,
    wallMs: Date.now() - started,
    passed: outcome.passed,
    score: outcome.score,
    evidenceRecall: evidenceRecall(trial.scenario, stream.texts),
    tools: stream.tools,
    editCalls: stream.editCalls,
    denials: denials.length,
    gateDenials: stream.gateDenials,
    questionsAsked: [...new Set(denials.flatMap(event => event.questions || []))].sort(),
    hookObserved: hookWasObserved({
      gated,
      editCalls: stream.editCalls,
      shellCalls: stream.shellCalls,
      metrics,
      gateDenials: stream.gateDenials
    }),
    ...usageOf(stream.result)
  };
}

// --- analysis ---

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function binomialTwoSided(k, n) {
  if (n === 0) return 1;
  let tail = 0;
  const low = Math.min(k, n - k);
  let term = Math.pow(0.5, n);
  for (let i = 0; i <= low; i++) {
    tail += term;
    term *= (n - i) / (i + 1);
  }
  return Math.min(1, 2 * tail);
}

/** Paired comparison of an arm against the reference arm over trials sharing scenario and rep. */
function pairedComparison(rows, reference, arm, { rounds = 4000, seed = 0x9e3779b9 } = {}) {
  const byKey = new Map(rows.filter(row => row.arm === reference).map(row => [`${row.scenario}/${row.rep}`, row]));
  const pairs = rows.filter(row => row.arm === arm && byKey.has(`${row.scenario}/${row.rep}`)).map(row => [byKey.get(`${row.scenario}/${row.rep}`), row]);
  const diffs = pairs.map(([ref, other]) => Number(other.passed) - Number(ref.passed));
  const onlyReference = pairs.filter(([ref, other]) => ref.passed && !other.passed).length;
  const onlyArm = pairs.filter(([ref, other]) => !ref.passed && other.passed).length;
  const random = xorshift(seed);
  const means = [];
  for (let i = 0; i < rounds && diffs.length; i++) {
    let sum = 0;
    for (let j = 0; j < diffs.length; j++) sum += diffs[random(diffs.length)];
    means.push(sum / diffs.length);
  }
  means.sort((a, b) => a - b);
  return {
    arm,
    reference,
    pairs: pairs.length,
    passRateDifference: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
    interval: means.length ? [means[Math.floor(rounds * 0.025)], means[Math.ceil(rounds * 0.975) - 1]] : null,
    onlyReference,
    onlyArm,
    mcnemarP: binomialTwoSided(Math.min(onlyReference, onlyArm), onlyReference + onlyArm)
  };
}

function armSummary(rows, arm) {
  const own = rows.filter(row => row.arm === arm);
  const passes = own.filter(row => row.passed).length;
  return {
    arm,
    trials: own.length,
    passes,
    passInterval: wilson(passes, own.length),
    meanScore: own.length ? own.reduce((sum, row) => sum + row.score, 0) / own.length : null,
    medianTokens: median(own.map(row => row.inputTokens + row.cachedInputTokens + row.outputTokens)),
    medianOutputTokens: median(own.map(row => row.outputTokens)),
    medianCostUsd: median(own.map(row => row.costUsd)),
    medianTurns: median(own.map(row => row.turns)),
    medianWallMs: median(own.map(row => row.wallMs)),
    medianDenials: median(own.map(row => row.gateDenials)),
    meanEvidenceRecall: own.length ? own.reduce((sum, row) => sum + row.evidenceRecall, 0) / own.length : null,
    providerErrors: own.filter(row => row.providerError || row.timedOut).length
  };
}

function summarize(rows, arms, reference = 'gate') {
  const valid = rows.filter(row => !row.providerError && !row.timedOut);
  const scenarios = [...new Set(valid.map(row => row.scenario))].sort();
  return {
    arms: arms.map(arm => armSummary(rows, arm)),
    comparisons: arms.filter(arm => arm !== reference).map(arm => pairedComparison(valid, reference, arm)),
    byScenario: scenarios.map(scenario => ({
      scenario,
      question: (valid.find(row => row.scenario === scenario) || {}).question,
      arms: Object.fromEntries(arms.map(arm => {
        const own = valid.filter(row => row.scenario === scenario && row.arm === arm);
        return [arm, { passes: own.filter(row => row.passed).length, trials: own.length, evidence: own.length ? own.reduce((s, r) => s + r.evidenceRecall, 0) / own.length : null }];
      }))
    }))
  };
}

function renderMarkdown(summary, meta = {}) {
  const pct = value => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);
  const num = value => (value === null ? 'n/a' : String(Math.round(value * 100) / 100));
  const lines = [];
  if (meta.model) lines.push(`Model: ${meta.model}; hook commit: ${meta.sha || 'n/a'}; reps: ${meta.reps || 'n/a'}.`, '');
  lines.push('| Arm | Trials | Passed (95% interval) | Mean score | Evidence stated | Median denials | Median turns | Median tokens | Median cost (USD) | Errors |');
  lines.push('| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const a of summary.arms) {
    lines.push(`| ${a.arm} | ${a.trials} | ${a.passes}/${a.trials} (${pct(a.passInterval[0])}–${pct(a.passInterval[1])}) | ${num(a.meanScore)} | ${pct(a.meanEvidenceRecall)} | ${num(a.medianDenials)} | ${num(a.medianTurns)} | ${num(a.medianTokens)} | ${num(a.medianCostUsd)} | ${a.providerErrors} |`);
  }
  lines.push('', '| Arm vs gate | Pairs | Pass-rate difference (95% interval) | Gate only | Arm only | McNemar p |', '| --- | ---: | --- | ---: | ---: | ---: |');
  for (const c of summary.comparisons) {
    const interval = c.interval ? `${pct(c.interval[0])} to ${pct(c.interval[1])}` : 'n/a';
    lines.push(`| ${c.arm} | ${c.pairs} | ${pct(c.passRateDifference)} (${interval}) | ${c.onlyReference} | ${c.onlyArm} | ${num(c.mcnemarP)} |`);
  }
  const arms = summary.arms.map(a => a.arm);
  lines.push('', `| Scenario | Question | ${arms.join(' | ')} |`, `| --- | --- | ${arms.map(() => '---:').join(' | ')} |`);
  for (const s of summary.byScenario) {
    lines.push(`| ${s.scenario} | ${s.question} | ${arms.map(arm => `${s.arms[arm].passes}/${s.arms[arm].trials}`).join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  loadScenarios,
  prepareWorkspace,
  commitWorkspace,
  grade,
  changedHunk,
  questionsForReference,
  schedule,
  childEnv,
  claudeArgs,
  parseStream,
  readMetrics,
  hookWasObserved,
  evidenceRecall,
  runTrial,
  binomialTwoSided,
  pairedComparison,
  summarize,
  renderMarkdown
};
