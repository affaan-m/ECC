#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { pathToFileURL } = require('url');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK_RELATIVE_PATH = 'scripts/hooks/gateguard-fact-force.js';
const DEFAULT_CORPUS_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'gateguard-scenarios');
const DEFAULT_BASELINE = 'upstream/main';
const EXPECTATIONS = new Set(['deny', 'allow']);
const TOKEN_CHARS = 4;
const CONDENSED_PREFIX = /^\[Fact-Forcing Gate\] \(denial #\d+ this session\) First (edit|creation) of /;

const QUESTION_IDS = Object.freeze([
  'importers',
  'public-api',
  'local-callers',
  'callers',
  'no-duplicate',
  'data-schema',
  'loader',
  'behaviour-change',
  'no-duplicate-instruction',
  'under-test',
  'existing-tests',
  'supersedes',
  'linked-from',
  'why-new-file',
  'references',
  'corrects-or-adds',
  'config-reader',
  'config-effect',
  'no-plaintext-secrets',
  'quote-instruction'
]);

const LEGACY_CONDENSED_PHRASES = Object.freeze([
  { phrase: 'call sites in this file or its module', ids: { edit: 'local-callers', creation: 'local-callers' } },
  { phrase: 'importers/callers', ids: { edit: 'importers', creation: 'callers' } },
  { phrase: 'affected API', ids: { edit: 'public-api', creation: 'public-api' } },
  { phrase: 'data schemas', ids: { edit: 'data-schema', creation: 'data-schema' } },
  { phrase: 'verbatim instruction', ids: { edit: 'quote-instruction', creation: 'quote-instruction' } }
]);

// --- corpus ---

function fail(message) {
  throw new Error(message);
}

function validateStep(scenario, step, index) {
  const where = `${scenario.name} step ${index + 1}`;
  if (!step || typeof step !== 'object') fail(`${where}: not an object`);
  if (typeof step.id !== 'string' || !step.id) fail(`${where}: missing id`);
  if (!step.payload || typeof step.payload !== 'object') fail(`${where}: missing payload`);
  if (typeof step.payload.tool_name !== 'string') fail(`${where}: payload.tool_name must be a string`);
  if (!EXPECTATIONS.has(step.expect)) fail(`${where}: expect must be deny or allow`);
  if (typeof step.mustDeny !== 'boolean') fail(`${where}: mustDeny must be a boolean`);
  if (typeof step.redundant !== 'boolean') fail(`${where}: redundant must be a boolean`);
  if (step.mustDeny && step.expect !== 'deny') fail(`${where}: mustDeny requires expect deny`);
  if (step.redundant && step.expect !== 'allow') fail(`${where}: redundant requires expect allow`);
  if (step.relevantQuestions !== undefined) {
    const ids = step.relevantQuestions;
    if (!Array.isArray(ids) || ids.some(id => !QUESTION_IDS.includes(id))) fail(`${where}: unknown relevantQuestions id`);
  }
  if (step.transcript !== undefined && !Array.isArray(step.transcript)) fail(`${where}: transcript must be an array`);
}

function validateScenario(scenario, file) {
  if (!scenario || typeof scenario !== 'object') fail(`${file}: not an object`);
  if (typeof scenario.name !== 'string' || !scenario.name) fail(`${file}: missing name`);
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) fail(`${file}: steps must be a non-empty array`);
  const ids = new Set();
  scenario.steps.forEach((step, index) => {
    validateStep(scenario, step, index);
    if (ids.has(step.id)) fail(`${scenario.name}: duplicate step id ${step.id}`);
    ids.add(step.id);
  });
}

/** Load and validate every scenario file in a corpus directory, sorted by file name. */
function loadCorpus(dir = DEFAULT_CORPUS_DIR) {
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => {
      const scenario = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      validateScenario(scenario, name);
      return { ...scenario, file: name };
    });
}

// --- baseline materialisation ---

function gitShow(ref, relativePath) {
  return execFileSync('git', ['show', `${ref}:${relativePath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function relativeRequires(source) {
  const specs = [];
  const pattern = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) specs.push(match[1]);
  return specs;
}

function requireTarget(fromFile, spec) {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  return path.posix.extname(joined) ? joined : `${joined}.js`;
}

/** Write the hook at a git ref, and every file it requires relatively, into a temp tree; returns the hook path. */
function materializeHook(ref, outDir) {
  const seen = new Set();
  const queue = [HOOK_RELATIVE_PATH];
  while (queue.length > 0) {
    const relative = queue.shift();
    if (seen.has(relative)) continue;
    seen.add(relative);
    let source;
    try {
      source = gitShow(ref, relative);
    } catch (error) {
      fail(`cannot read ${relative} at ${ref} (fetch the ref first): ${String(error.stderr || error.message).trim()}`);
    }
    const target = path.join(outDir, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source, 'utf8');
    if (relative.endsWith('.js')) relativeRequires(source).forEach(spec => queue.push(requireTarget(relative, spec)));
  }
  return path.join(outDir, ...HOOK_RELATIVE_PATH.split('/'));
}

// --- scenario setup ---

function substitute(value, vars) {
  if (typeof value === 'string') return value.replace(/\{\{(root|transcript)\}\}/g, (_, name) => vars[name]);
  if (Array.isArray(value)) return value.map(item => substitute(item, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, vars)]));
  }
  return value;
}

function createSymlink(root, link, target) {
  const linkPath = path.join(root, ...link.split('/'));
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const resolved = path.resolve(path.dirname(linkPath), ...target.split('/'));
  const isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  if (process.platform === 'win32' && isDir) fs.symlinkSync(resolved, linkPath, 'junction');
  else fs.symlinkSync(target, linkPath, isDir ? 'dir' : 'file');
}

function createHardLink(root, link, target) {
  const linkPath = path.join(root, ...link.split('/'));
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.linkSync(path.join(root, ...target.split('/')), linkPath);
}

function prepareScenario(scenario, workDir) {
  const root = scenario.root || fs.realpathSync(fs.mkdtempSync(path.join(workDir, 'project-')));
  if (!scenario.root) {
    for (const [relative, content] of Object.entries(scenario.files || {})) {
      const file = path.join(root, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    }
    for (const dir of scenario.dirs || []) fs.mkdirSync(path.join(root, ...dir.split('/')), { recursive: true });
    try {
      for (const [link, target] of Object.entries(scenario.symlinks || {})) createSymlink(root, link, target);
    } catch (error) {
      return { skipped: `symlinks unavailable: ${error.code || error.message}` };
    }
    try {
      for (const [link, target] of Object.entries(scenario.hardlinks || {})) createHardLink(root, link, target);
    } catch (error) {
      return { skipped: `hard links unavailable: ${error.code || error.message}` };
    }
  }
  const stateDir = fs.mkdtempSync(path.join(workDir, 'state-'));
  const home = fs.mkdtempSync(path.join(workDir, 'home-'));
  const transcript = path.join(fs.mkdtempSync(path.join(workDir, 'transcript-')), 'session.jsonl');
  const vars = { root, transcript };
  const env = {
    PATH: process.env.PATH || '',
    HOME: home,
    USERPROFILE: home,
    GATEGUARD_STATE_DIR: stateDir,
    CLAUDE_PROJECT_DIR: root,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(scenario.env || {})
  };
  const steps = scenario.steps.map(step => ({
    id: step.id,
    records: substitute(step.transcript || [], vars),
    payload: substitute(step.payload, vars)
  }));
  return { env, transcript, steps };
}

// --- hook execution ---

function runStepsInWorker(hookFile, prepared) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      env: prepared.env,
      workerData: { gateguardEval: true, hookFile, transcript: prepared.transcript, steps: prepared.steps }
    });
    let outcome = null;
    worker.once('message', message => {
      outcome = message;
    });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (outcome) resolve(outcome);
      else reject(new Error(`scenario worker exited with code ${code}`));
    });
  });
}

function hookOutput(result) {
  if (!result || typeof result !== 'object') return { decision: null, reason: '', context: '' };
  let parsed = null;
  if (typeof result.stdout === 'string' && result.stdout) {
    try {
      parsed = JSON.parse(result.stdout);
    } catch (_) {
      parsed = null;
    }
  }
  const specific = parsed && parsed.hookSpecificOutput ? parsed.hookSpecificOutput : {};
  const context = [].concat(result.additionalContext || specific.additionalContext || []).join('\n');
  return { decision: specific.permissionDecision || null, reason: specific.permissionDecisionReason || '', context };
}

function allowKind(context) {
  if (context.includes('Prior search seen in this turn')) return 'credit';
  if (context.includes('Sibling of ')) return 'sibling';
  if (context.includes('Comment or whitespace-only change')) return 'trivial';
  return 'pass';
}

function workerMain() {
  const { hookFile, transcript, steps } = workerData;
  const hook = require(hookFile);
  const results = [];
  for (const step of steps) {
    if (step.records.length > 0) {
      fs.appendFileSync(transcript, step.records.map(record => `${JSON.stringify(record)}\n`).join(''), 'utf8');
    }
    const raw = JSON.stringify(step.payload);
    let result;
    let error = null;
    const started = performance.now();
    try {
      result = hook.run(raw);
    } catch (thrown) {
      error = String(thrown && thrown.message ? thrown.message : thrown);
      result = raw;
    }
    const latencyMs = performance.now() - started;
    const output = hookOutput(result);
    const denied = output.decision === 'deny';
    results.push({
      id: step.id,
      decision: denied ? 'deny' : 'allow',
      kind: denied ? 'deny' : allowKind(output.context),
      explicitAllow: output.decision === 'allow',
      reason: output.reason,
      latencyMs,
      error
    });
  }
  parentPort.postMessage({ results });
}

/** Run every scenario against one hook file; each scenario gets its own project, state dir, transcript and clean env. */
async function runCorpus(hookFile, scenarios) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-eval-'));
  try {
    const runs = [];
    for (const scenario of scenarios) {
      const prepared = prepareScenario(scenario, workDir);
      if (prepared.skipped) {
        runs.push({ scenario, skipped: prepared.skipped, results: [] });
        continue;
      }
      const { results } = await runStepsInWorker(hookFile, prepared);
      runs.push({ scenario, skipped: null, results });
    }
    return runs;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// --- cold latency ---
// see docs/gateguard/evaluation.md#latency

const COLD_PROBE = [
  "const { performance } = require('perf_hooks');",
  'const started = performance.now();',
  'const hook = require(process.argv[1]);',
  'const result = hook.run(process.argv[2]);',
  'const ms = performance.now() - started;',
  'process.stdout.write(JSON.stringify({ ms, result: result === undefined ? null : result }));'
].join('\n');

/** Replay every scenario with one fresh Node process per step; returns per-step require+run latency and decisions. */
function measureColdLatency(hookFile, scenarios) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-cold-'));
  try {
    const steps = [];
    for (const scenario of scenarios) {
      const prepared = prepareScenario(scenario, workDir);
      if (prepared.skipped) continue;
      for (const step of prepared.steps) {
        if (step.records.length > 0) {
          fs.appendFileSync(prepared.transcript, step.records.map(record => `${JSON.stringify(record)}\n`).join(''), 'utf8');
        }
        const raw = JSON.stringify(step.payload);
        const stdout = execFileSync(process.execPath, ['-e', COLD_PROBE, hookFile, raw], {
          env: prepared.env,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        const { ms, result } = JSON.parse(stdout);
        const output = hookOutput(result);
        steps.push({ scenario: scenario.name, step: step.id, latencyMs: ms, decision: output.decision === 'deny' ? 'deny' : 'allow' });
      }
    }
    return steps;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function coldSummary(coldSteps, warmSteps) {
  const sorted = coldSteps.map(step => step.latencyMs).sort((a, b) => a - b);
  const warmDecisions = new Map(warmSteps.map(step => [`${step.scenario}/${step.step}`, step.decision]));
  const disagreements = coldSteps.filter(step => warmDecisions.get(`${step.scenario}/${step.step}`) !== step.decision).length;
  return {
    p50Ms: Number(percentile(sorted, 0.5).toFixed(3)),
    p90Ms: Number(percentile(sorted, 0.9).toFixed(3)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
    disagreements
  };
}

// --- question mapping ---

function questionTextTable() {
  const { questionText, condensedQuestionPhrase } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'gateguard-target-class'));
  const table = new Map(QUESTION_IDS.map(id => [questionText(id), id]));
  table.condensed = [
    ...QUESTION_IDS.filter(id => condensedQuestionPhrase(id)).map(id => ({ phrase: condensedQuestionPhrase(id), ids: { edit: id, creation: id } })),
    ...LEGACY_CONDENSED_PHRASES
  ];
  return table;
}

/** Question ids a denial asked, read from its numbered list or its condensed hint. */
function questionsAsked(reason, table) {
  const numbered = reason
    .split('\n')
    .map(line => line.match(/^\d+\. (.+)$/))
    .filter(Boolean)
    .map(match => table.get(match[1]) || `unmapped:${match[1]}`);
  if (numbered.length > 0) return numbered;
  const condensed = reason.match(CONDENSED_PREFIX);
  if (!condensed) return [];
  const phrases = table.condensed || LEGACY_CONDENSED_PHRASES;
  return [...new Set(phrases.filter(({ phrase }) => reason.includes(phrase)).map(({ ids }) => ids[condensed[1]]))];
}

// --- metrics ---

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

/** Metrics for one hook's run of the corpus, plus per-step detail. */
function summarize(runs, table = questionTextTable()) {
  const totals = {
    scenarios: 0,
    skippedScenarios: 0,
    steps: 0,
    denials: 0,
    redundantDenials: 0,
    mustDenyBypasses: 0,
    mismatches: 0,
    irrelevantQuestions: 0,
    irrelevantInCondensed: 0,
    missedQuestions: 0,
    unmappedQuestions: 0,
    explicitAllows: 0,
    errors: 0,
    denialTokens: 0,
    allowsByKind: { credit: 0, sibling: 0, trivial: 0, pass: 0 }
  };
  const latencies = [];
  const steps = [];
  const perScenario = [];
  for (const run of runs) {
    if (run.skipped) {
      totals.skippedScenarios += 1;
      perScenario.push({ name: run.scenario.name, skipped: run.skipped, steps: 0, denials: 0 });
      continue;
    }
    totals.scenarios += 1;
    let scenarioDenials = 0;
    run.results.forEach((result, index) => {
      const step = run.scenario.steps[index];
      const denied = result.decision === 'deny';
      const relevant = Array.isArray(step.relevantQuestions) ? step.relevantQuestions : null;
      const asked = denied && relevant ? questionsAsked(result.reason, table) : [];
      const irrelevant = denied && relevant ? asked.filter(id => !relevant.includes(id)) : [];
      const missed = denied && relevant ? relevant.filter(id => !asked.includes(id)) : [];
      totals.steps += 1;
      latencies.push(result.latencyMs);
      if (denied) {
        totals.denials += 1;
        scenarioDenials += 1;
        totals.denialTokens += Math.ceil(result.reason.length / TOKEN_CHARS);
        if (step.redundant) totals.redundantDenials += 1;
      } else {
        totals.allowsByKind[result.kind] += 1;
        if (step.mustDeny) totals.mustDenyBypasses += 1;
      }
      if (result.decision !== step.expect) totals.mismatches += 1;
      const condensed = denied && CONDENSED_PREFIX.test(result.reason);
      totals.irrelevantQuestions += irrelevant.length;
      if (condensed) totals.irrelevantInCondensed += irrelevant.length;
      totals.missedQuestions += missed.length;
      totals.unmappedQuestions += asked.filter(id => id.startsWith('unmapped:')).length;
      if (result.explicitAllow) totals.explicitAllows += 1;
      if (result.error) totals.errors += 1;
      steps.push({
        scenario: run.scenario.name,
        file: run.scenario.file,
        step: step.id,
        expect: step.expect,
        decision: result.decision,
        kind: result.kind,
        mustDeny: step.mustDeny,
        redundant: step.redundant,
        condensed,
        questions: asked,
        irrelevant,
        missed,
        latencyMs: Number(result.latencyMs.toFixed(3)),
        ...(result.explicitAllow ? { explicitAllow: true } : {}),
        ...(result.error ? { error: result.error } : {})
      });
    });
    perScenario.push({ name: run.scenario.name, skipped: null, steps: run.results.length, denials: scenarioDenials });
  }
  const sorted = latencies.slice().sort((a, b) => a - b);
  return {
    totals,
    latency: {
      p50Ms: Number(percentile(sorted, 0.5).toFixed(3)),
      p90Ms: Number(percentile(sorted, 0.9).toFixed(3)),
      p95Ms: Number(percentile(sorted, 0.95).toFixed(3))
    },
    perScenario,
    steps
  };
}

// --- reporting ---

const METRIC_ROWS = [
  ['Steps', s => s.totals.steps],
  ['Denials', s => s.totals.denials],
  ['Redundant denials', s => s.totals.redundantDenials],
  ['Must-deny bypasses', s => s.totals.mustDenyBypasses],
  ['Expectation mismatches', s => s.totals.mismatches],
  ['Irrelevant questions asked', s => s.totals.irrelevantQuestions],
  ['Irrelevant questions in condensed denials', s => s.totals.irrelevantInCondensed],
  ['Warranted questions not asked', s => s.totals.missedQuestions],
  ['Estimated denial tokens', s => s.totals.denialTokens],
  ['Allows with a credit note', s => s.totals.allowsByKind.credit],
  ['Allows with a sibling note', s => s.totals.allowsByKind.sibling],
  ['Allows with a trivial-edit note', s => s.totals.allowsByKind.trivial],
  ['Hook latency p50, fresh process (ms)', s => (s.cold ? s.cold.p50Ms.toFixed(2) : 'not run')],
  ['Hook latency p90, fresh process (ms)', s => (s.cold ? s.cold.p90Ms.toFixed(2) : 'not run')],
  ['Hook latency p95, fresh process (ms)', s => (s.cold ? s.cold.p95Ms.toFixed(2) : 'not run')],
  ['run() latency p50, warm (ms)', s => s.latency.p50Ms.toFixed(2)],
  ['run() latency p90, warm (ms)', s => s.latency.p90Ms.toFixed(2)],
  ['run() latency p95, warm (ms)', s => s.latency.p95Ms.toFixed(2)]
];

function markdownTable(header, rows) {
  const line = cells => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map((_, i) => (i === 0 ? '---' : '---:'))), ...rows.map(line)].join('\n');
}

/** Markdown report: metric table, per-scenario denials, and any working-tree mismatches. */
function renderMarkdown(report) {
  const labels = report.hooks.map(hook => hook.label);
  const lines = [
    `Corpus: ${report.corpus.scenarios} scenarios, ${report.corpus.steps} steps.`,
    '',
    markdownTable(['Metric', ...labels], METRIC_ROWS.map(([name, pick]) => [name, ...report.hooks.map(hook => String(pick(hook.summary)))])),
    '',
    markdownTable(
      ['Scenario', 'Steps', ...labels.map(label => `Denials: ${label}`)],
      report.hooks[0].summary.perScenario.map((row, index) => [
        row.name,
        String(row.steps),
        ...report.hooks.map(hook => {
          const entry = hook.summary.perScenario[index];
          return entry.skipped ? 'skipped' : String(entry.denials);
        })
      ])
    )
  ];
  const working = report.hooks[0].summary;
  const mismatched = working.steps.filter(step => step.decision !== step.expect);
  if (mismatched.length > 0) {
    lines.push('', `${report.hooks[0].label} mismatches:`, '');
    mismatched.forEach(step => lines.push(`- ${step.scenario} / ${step.step}: expected ${step.expect}, got ${step.decision} (${step.kind})`));
  }
  const cold = report.hooks[0].summary.cold;
  if (cold && cold.disagreements > 0) {
    lines.push('', `${report.hooks[0].label}: ${cold.disagreements} step(s) decided differently in a fresh process.`);
  }
  return `${lines.join('\n')}\n`;
}

const SARIF_RULES = Object.freeze([
  {
    id: 'gateguard/must-deny-bypass',
    level: 'error',
    name: 'MustDenyBypass',
    text: 'A step that must be denied (sensitive target, bypass attempt, or mutating first command) was allowed.'
  },
  {
    id: 'gateguard/explicit-allow',
    level: 'error',
    name: 'ExplicitAllow',
    text: 'The hook emitted permissionDecision "allow", which skips the host permission prompt.'
  },
  {
    id: 'gateguard/hook-error',
    level: 'error',
    name: 'HookError',
    text: 'The hook threw or produced unparseable output for a step.'
  },
  {
    id: 'gateguard/expectation-mismatch',
    level: 'warning',
    name: 'ExpectationMismatch',
    text: 'The hook decision differs from the decision the scenario expects.'
  }
]);

function sarifFindings(step) {
  const findings = [];
  if (step.mustDeny && step.decision !== 'deny') findings.push('gateguard/must-deny-bypass');
  if (step.explicitAllow) findings.push('gateguard/explicit-allow');
  if (step.error) findings.push('gateguard/hook-error');
  if (step.decision !== step.expect && findings.length === 0) findings.push('gateguard/expectation-mismatch');
  return findings;
}

function sarifArtifactLocation(corpusDir, file) {
  const absolute = path.resolve(corpusDir || DEFAULT_CORPUS_DIR, file || '');
  const relative = path.relative(REPO_ROOT, absolute);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return { uri: relative.split(path.sep).join('/'), uriBaseId: '%SRCROOT%' };
  }
  return { uri: pathToFileURL(absolute).href };
}

function sarifTotals(summary) {
  const { steps, denials, mustDenyBypasses, mismatches, explicitAllows, errors, skippedScenarios } = summary.totals;
  return { steps, denials, mustDenyBypasses, mismatches, explicitAllows, errors, skippedScenarios };
}

/** SARIF 2.1.0 log of working-tree gate failures, with per-hook totals; timing is omitted so output is reproducible. */
function renderSarif(report) {
  const working = report.hooks[0].summary;
  const levels = new Map(SARIF_RULES.map(rule => [rule.id, rule.level]));
  const results = [];
  for (const step of working.steps) {
    for (const ruleId of sarifFindings(step)) {
      results.push({
        ruleId,
        level: levels.get(ruleId),
        message: { text: `${step.scenario} / ${step.step}: expected ${step.expect}, got ${step.decision} (${step.kind})` },
        locations: [
          {
            physicalLocation: { artifactLocation: sarifArtifactLocation(report.corpusDir, step.file) }
          }
        ]
      });
    }
  }
  const log = {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'gateguard-eval',
            informationUri: 'https://github.com/affaan-m/ECC/blob/main/docs/gateguard/evaluation.md',
            rules: SARIF_RULES.map(rule => ({
              id: rule.id,
              name: rule.name,
              shortDescription: { text: rule.text },
              defaultConfiguration: { level: rule.level }
            }))
          }
        },
        automationDetails: { id: 'gateguard/scenario-corpus' },
        invocations: [{ executionSuccessful: true }],
        properties: {
          corpus: report.corpus,
          hooks: report.hooks.map(hook => ({ label: hook.label, totals: sarifTotals(hook.summary) }))
        },
        results
      }
    ]
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}

// --- CLI ---

const USAGE = [
  'Usage: node scripts/dev/gateguard-eval.js [--markdown | --json] [--baseline <ref>]... [--corpus <dir>] [--sarif <file>]',
  '',
  '  --baseline <ref>  git ref whose hook is compared with the working tree (repeatable;',
  `                    default ${DEFAULT_BASELINE})`,
  '  --corpus <dir>    scenario directory (default tests/fixtures/gateguard-scenarios)',
  '  --markdown        print markdown tables (default)',
  '  --json            print the full report as JSON',
  '  --sarif <file>    also write working-tree gate failures as SARIF 2.1.0',
  '  --no-cold         skip the fresh-process latency pass (one Node process per step)'
].join('\n');

function parseArgs(argv) {
  const options = { format: 'markdown', baselines: [], corpus: DEFAULT_CORPUS_DIR, sarif: null, cold: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--markdown') options.format = 'markdown';
    else if (arg === '--json') options.format = 'json';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--no-cold') options.cold = false;
    else if ((arg === '--baseline' || arg === '--corpus' || arg === '--sarif') && i + 1 < argv.length) {
      if (arg === '--baseline') options.baselines.push(argv[++i]);
      else if (arg === '--sarif') options.sarif = path.resolve(argv[++i]);
      else options.corpus = path.resolve(argv[++i]);
    } else fail(`unknown or incomplete argument: ${arg}\n\n${USAGE}`);
  }
  if (options.baselines.length === 0) options.baselines.push(DEFAULT_BASELINE);
  return options;
}

/** Evaluate the working-tree hook and each baseline ref over a corpus. */
async function evaluate({ baselines = [DEFAULT_BASELINE], corpus = DEFAULT_CORPUS_DIR, cold = false } = {}) {
  const scenarios = loadCorpus(corpus);
  const table = questionTextTable();
  const hooks = [{ label: 'working tree', ref: null, file: path.join(REPO_ROOT, ...HOOK_RELATIVE_PATH.split('/')) }];
  const materialized = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-baseline-'));
  try {
    baselines.forEach((ref, index) => {
      hooks.push({ label: ref, ref, file: materializeHook(ref, path.join(materialized, String(index))) });
    });
    const evaluated = [];
    for (const hook of hooks) {
      const summary = summarize(await runCorpus(hook.file, scenarios), table);
      if (cold) summary.cold = coldSummary(measureColdLatency(hook.file, scenarios), summary.steps);
      evaluated.push({ label: hook.label, ref: hook.ref, summary });
    }
    return {
      corpus: { scenarios: scenarios.length, steps: scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0) },
      corpusDir: corpus,
      hooks: evaluated
    };
  } finally {
    fs.rmSync(materialized, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const report = await evaluate(options);
  process.stdout.write(options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  if (options.sarif) fs.writeFileSync(options.sarif, renderSarif(report), 'utf8');
  const working = report.hooks[0].summary.totals;
  const coldDisagreements = report.hooks[0].summary.cold ? report.hooks[0].summary.cold.disagreements : 0;
  if (working.mustDenyBypasses > 0 || working.mismatches > 0 || working.explicitAllows > 0 || working.errors > 0 || coldDisagreements > 0) {
    process.exitCode = 1;
  }
}

if (!isMainThread && workerData && workerData.gateguardEval) {
  workerMain();
} else if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[gateguard-eval] ${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { loadCorpus, materializeHook, runCorpus, measureColdLatency, summarize, questionsAsked, renderMarkdown, renderSarif, parseArgs, evaluate };
