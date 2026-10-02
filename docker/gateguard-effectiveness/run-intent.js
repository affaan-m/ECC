#!/usr/bin/env node
'use strict';

// Hidden-intent effectiveness run.
//
// Separate from run.js on purpose: run.js measures the gate's cost in one-shot
// autonomous sessions and remains the cost baseline. This runner measures
// whether the gate's questions obtain a fact the repository does not hold, and
// reports the holes rather than asserting coverage.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { schedule } = require('./lib');
const { ARMS, armSettings, resolveRef, materializeTree } = require('./arms');
const { loadIntentScenarios, graderIsSound, runIntentTrial, SUPPORTED_ARMS } = require('./intent-eval');
const { renderHoles, difficulty } = require('./coverage');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const USAGE = [
  'Usage: node docker/gateguard-effectiveness/run-intent.js --out <dir> --model <model> --allow-real-provider [options]',
  '',
  '  --out <dir>             results.jsonl, holes.md and transcripts/ (a rerun resumes)',
  '  --model <model>         Claude model under test (required unless --dry-run or --summarize)',
  '  --allow-real-provider   run real Claude sessions (each trial is several billed turns)',
  '  --judge-model <model>   model playing the user (default: haiku)',
  `  --arms <a,b,...>        ${SUPPORTED_ARMS.join(', ')} (default: off,gate,placebo)`,
  '  --scenarios <a,b,...>   scenario ids (default: all)',
  '  --reps <n>              repetitions per scenario and arm (default: 3)',
  '  --user-turns <n>        how many times the user will answer (default: 3)',
  '  --max-turns <n>         agent turn limit per invocation (default: 40)',
  '  --timeout-min <n>       wall-clock limit per invocation (default: 15)',
  '  --seed <n>              arm order seed (default: 11)',
  '  --check-graders         confirm every grader separates start, trap and reference, then exit',
  '  --dry-run               print the schedule without running sessions',
  '  --summarize             only rebuild holes.md from results.jsonl'
].join('\n');

function parseArgs(argv) {
  const options = {
    out: null, model: null, judgeModel: 'haiku', claude: 'claude',
    arms: ['off', 'gate', 'placebo'], scenarios: null, reps: 3, userTurns: 3,
    candidateRef: 'HEAD', mainRef: 'upstream/main', maxTurns: 40, timeoutMin: 15, seed: 11,
    allowRealProvider: false, dryRun: false, summarizeOnly: false, checkGraders: false, help: false
  };
  const list = value => value.split(',').map(item => item.trim()).filter(Boolean);
  const positive = (value, name) => {
    if (!/^[1-9]\d*$/.test(value || '')) throw new Error(`${name} needs a positive integer\n\n${USAGE}`);
    return Number(value);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value\n\n${USAGE}`);
      return argv[++i];
    };
    if (arg === '--out') options.out = path.resolve(next());
    else if (arg === '--model') options.model = next();
    else if (arg === '--judge-model') options.judgeModel = next();
    else if (arg === '--claude') options.claude = next();
    else if (arg === '--arms') options.arms = list(next());
    else if (arg === '--scenarios') options.scenarios = list(next());
    else if (arg === '--reps') options.reps = positive(next(), '--reps');
    else if (arg === '--user-turns') options.userTurns = positive(next(), '--user-turns');
    else if (arg === '--candidate-ref') options.candidateRef = next();
    else if (arg === '--main-ref') options.mainRef = next();
    else if (arg === '--max-turns') options.maxTurns = positive(next(), '--max-turns');
    else if (arg === '--timeout-min') options.timeoutMin = positive(next(), '--timeout-min');
    else if (arg === '--seed') options.seed = positive(next(), '--seed');
    else if (arg === '--allow-real-provider') options.allowRealProvider = true;
    else if (arg === '--check-graders') options.checkGraders = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--summarize') options.summarizeOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
  }
  const unsupported = options.arms.filter(arm => !SUPPORTED_ARMS.includes(arm));
  if (unsupported.length) throw new Error(`arm not supported for hidden-intent scenarios: ${unsupported.join(', ')}`);
  if (!options.help && !options.checkGraders && !options.out) throw new Error(`--out is required\n\n${USAGE}`);
  if (!options.help && !options.checkGraders && !options.dryRun && !options.summarizeOnly) {
    if (!options.model) throw new Error(`--model is required\n\n${USAGE}`);
    if (!options.allowRealProvider) throw new Error(`real sessions need --allow-real-provider\n\n${USAGE}`);
  }
  return options;
}

function readResults(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function writeReport(options, rows, meta) {
  const header = `Model: ${meta.model}; judge: ${meta.judgeModel}; hook commit: ${meta.sha}; reps: ${meta.reps}; user turns: ${meta.userTurns}.\n\n`;
  const body = rows.length ? renderHoles(rows) : 'No trials recorded yet.\n';
  fs.writeFileSync(path.join(options.out, 'holes.md'), header + body);
  fs.writeFileSync(
    path.join(options.out, 'summary.json'),
    `${JSON.stringify({ meta, difficulty: difficulty(rows), rows: rows.length }, null, 2)}\n`
  );
  return header + body;
}

function checkGraders(scenarios) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-grader-'));
  try {
    let bad = 0;
    for (const scenario of scenarios) {
      const { scores, sound } = graderIsSound(scenario, workRoot);
      const mark = sound ? 'ok  ' : 'BAD ';
      process.stdout.write(`${mark} ${scenario.id}: start=${scores.workspace} trap=${scores.naive} reference=${scores.reference}\n`);
      if (!sound) bad++;
    }
    if (bad) throw new Error(`${bad} grader(s) do not separate start, trap and reference`);
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const scenarios = loadIntentScenarios(undefined, options.scenarios);
  if (options.checkGraders) {
    checkGraders(scenarios);
    return;
  }

  fs.mkdirSync(path.join(options.out, 'transcripts'), { recursive: true });
  const resultsFile = path.join(options.out, 'results.jsonl');
  const metaFile = path.join(options.out, 'meta.json');
  const trees = { candidate: resolveRef(REPO_ROOT, options.candidateRef) };
  if (options.arms.includes('main')) trees.main = resolveRef(REPO_ROOT, options.mainRef);
  const meta = {
    model: options.model, judgeModel: options.judgeModel, sha: trees.candidate, mainSha: trees.main || null,
    reps: options.reps, userTurns: options.userTurns, arms: options.arms,
    scenarios: scenarios.map(scenario => scenario.id), maxTurns: options.maxTurns
  };
  if (fs.existsSync(metaFile)) {
    const previous = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    for (const key of ['model', 'judgeModel', 'sha', 'maxTurns', 'userTurns']) {
      if (!options.summarizeOnly && !options.dryRun && previous[key] !== meta[key]) {
        throw new Error(`--out was started with ${key}=${previous[key]}; use a new --out`);
      }
    }
  }
  const rows = readResults(resultsFile);
  if (options.summarizeOnly) {
    process.stdout.write(writeReport(options, rows, JSON.parse(fs.readFileSync(metaFile, 'utf8'))));
    return;
  }

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-intent-'));
  try {
    // A grader that does not separate start, trap and reference cannot produce a
    // usable trial, so it is caught before any session is billed.
    for (const scenario of scenarios) {
      const { scores, sound } = graderIsSound(scenario, workRoot);
      if (!sound) {
        throw new Error(`${scenario.id}: grader scores start=${scores.workspace} trap=${scores.naive} reference=${scores.reference}; fix it before spending sessions`);
      }
    }
    const treeRoots = {};
    for (const [name, sha] of Object.entries(trees)) {
      treeRoots[name] = materializeTree(REPO_ROOT, sha, path.join(workRoot, 'trees', name));
    }
    const armSettingsByName = Object.fromEntries(
      options.arms.map(arm => [arm, armSettings(ARMS[arm].gate ? treeRoots[ARMS[arm].tree] : null)])
    );
    const done = new Set(rows.map(row => row.key));
    const trials = schedule(scenarios, options.arms, options.reps, options.seed).filter(trial => !done.has(trial.key));
    process.stderr.write(`${trials.length} trials to run (${done.size} already recorded)\n`);
    if (options.dryRun) {
      for (const trial of trials) process.stdout.write(`${trial.key}\n`);
      return;
    }
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    let judgeFailures = 0;
    for (const [index, trial] of trials.entries()) {
      const transcript = [];
      const execute = (file, args, spawnOptions) => {
        const result = spawnSync(file, args, spawnOptions);
        if (result.stdout) transcript.push(result.stdout);
        return result;
      };
      const row = runIntentTrial(trial, {
        workRoot,
        armSettingsByName,
        executable: options.claude,
        model: options.model,
        judgeModel: options.judgeModel,
        maxTurns: options.maxTurns,
        timeoutMs: options.timeoutMin * 60000,
        userTurns: options.userTurns,
        execute
      });
      fs.writeFileSync(
        path.join(options.out, 'transcripts', `${trial.key.replace(/\//g, '__')}.jsonl`),
        transcript.join('\n')
      );
      fs.rmSync(path.join(workRoot, trial.key.replace(/\//g, '__')), { recursive: true, force: true });
      fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
      rows.push(row);
      writeReport(options, rows, meta);
      const verdict = row.passed ? 'pass' : `score ${row.score}`;
      process.stderr.write(
        `[${index + 1}/${trials.length}] ${trial.key}: ${verdict}, ${row.outcomeClass}, asked=${row.asked}, decisive=${row.disclosedDecisive}, denials=${row.gateDenials}\n`
      );
      judgeFailures = row.judgeFailed ? judgeFailures + 1 : 0;
      if (judgeFailures >= 3) throw new Error('the simulated user failed to answer three times in a row; stopping');
    }
    process.stdout.write(writeReport(options, rows, meta));
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[gateguard-intent] ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { parseArgs, writeReport, checkGraders };
