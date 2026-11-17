#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ARMS, DEFAULT_ARMS, resolveRef, materializeTree, armSettings } = require('./arms');
const { loadScenarios, schedule, runTrial, summarize, renderMarkdown, completedTrialKeys, isAuthenticationFailure } = require('./lib');

const REPO_ROOT = path.join(__dirname, '..', '..');

const USAGE = `Usage: node docker/gateguard-effectiveness/run.js --out <dir> --model <model> --allow-real-provider [options]

  --out <dir>             results.jsonl, summary.md and transcripts/ (a rerun resumes)
  --model <model>         Claude model for every trial (required unless --dry-run or --summarize)
  --allow-real-provider   run real Claude sessions (each trial is one billed session)
  --claude <path>         Claude Code executable (default: claude)
  --arms <a,b,...>        ${Object.keys(ARMS).join(', ')} (default: ${DEFAULT_ARMS.join(',')})
  --scenarios <a,b,...>   scenario ids (default: all)
  --reps <n>              repetitions per scenario and arm (default: 3)
  --candidate-ref <ref>   commit whose gate the gate, minus-target and placebo arms run (default: HEAD)
  --main-ref <ref>        commit whose gate the main arm runs (default: upstream/main)
  --max-turns <n>         agent turn limit per trial (default: 40)
  --timeout-min <n>       wall-clock limit per trial (default: 15)
  --seed <n>              arm order seed (default: 11)
  --dry-run               prepare hook trees and print the schedule without running sessions
  --summarize             only rebuild summary.md from results.jsonl`;

function parseArgs(argv) {
  const options = {
    out: null, model: null, claude: 'claude', arms: DEFAULT_ARMS.slice(), scenarios: null, reps: 3,
    candidateRef: 'HEAD', mainRef: 'upstream/main', maxTurns: 40, timeoutMin: 15, seed: 11,
    allowRealProvider: false, dryRun: false, summarizeOnly: false, help: false
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
    else if (arg === '--claude') options.claude = next();
    else if (arg === '--arms') options.arms = list(next());
    else if (arg === '--scenarios') options.scenarios = list(next());
    else if (arg === '--reps') options.reps = positive(next(), '--reps');
    else if (arg === '--candidate-ref') options.candidateRef = next();
    else if (arg === '--main-ref') options.mainRef = next();
    else if (arg === '--max-turns') options.maxTurns = positive(next(), '--max-turns');
    else if (arg === '--timeout-min') options.timeoutMin = positive(next(), '--timeout-min');
    else if (arg === '--seed') options.seed = positive(next(), '--seed');
    else if (arg === '--allow-real-provider') options.allowRealProvider = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--summarize') options.summarizeOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
  }
  const unknownArms = options.arms.filter(arm => !ARMS[arm]);
  if (unknownArms.length) throw new Error(`unknown arm: ${unknownArms.join(', ')}`);
  if (!options.help && !options.out) throw new Error(`--out is required\n\n${USAGE}`);
  if (!options.help && !options.dryRun && !options.summarizeOnly) {
    if (!options.model) throw new Error(`--model is required\n\n${USAGE}`);
    if (!options.allowRealProvider) throw new Error(`real sessions need --allow-real-provider\n\n${USAGE}`);
  }
  return options;
}

function readOptionalText(file, io = fs) {
  let fd;
  try {
    fd = io.openSync(file, io.constants.O_RDONLY | (io.constants.O_NOFOLLOW || 0) | (io.constants.O_NONBLOCK || 0));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    if (!io.fstatSync(fd).isFile()
      || (!io.constants.O_NOFOLLOW && io.lstatSync(file).isSymbolicLink())) {
      throw new Error('Resume metadata/results must be regular files without symlinks');
    }
    return io.readFileSync(fd, 'utf8');
  } finally { io.closeSync(fd); }
}

function writeMetadata(file, meta) {
  const temporary = path.join(path.dirname(file), `.meta-${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  let published = false;
  try {
    try { fs.writeFileSync(fd, `${JSON.stringify(meta, null, 2)}\n`); }
    finally { fs.closeSync(fd); }
    // Rename replaces the destination entry rather than following a raced symlink.
    fs.renameSync(temporary, file);
    published = true;
  } finally {
    if (!published) fs.unlinkSync(temporary);
  }
}

function withOutputLock(out, work) {
  const lock = path.join(out, '.run.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Output is locked; concurrent workers must use separate --out directories. Remove .run.lock only after confirming its worker has stopped.');
    throw error;
  }
  try {
    fs.writeFileSync(fd, `${process.pid}\n`);
    return work();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function readResults(file) {
  const text = readOptionalText(file);
  return text === null ? [] : text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function writeSummary(options, rows, meta) {
  const arms = options.arms.filter(arm => rows.some(row => row.arm === arm));
  const summary = summarize(rows, arms, arms.includes('gate') ? 'gate' : arms[0]);
  fs.writeFileSync(path.join(options.out, 'summary.md'), renderMarkdown(summary, meta));
  fs.writeFileSync(path.join(options.out, 'summary.json'), `${JSON.stringify({ meta, summary }, null, 2)}\n`);
  return summary;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  fs.mkdirSync(path.join(options.out, 'transcripts'), { recursive: true });
  return withOutputLock(options.out, () => {
    const resultsFile = path.join(options.out, 'results.jsonl');
    const metaFile = path.join(options.out, 'meta.json');
    const scenarios = loadScenarios(undefined, options.scenarios);
    const trees = { candidate: resolveRef(REPO_ROOT, options.candidateRef) };
    if (options.arms.includes('main')) trees.main = resolveRef(REPO_ROOT, options.mainRef);
    const meta = { model: options.model, sha: trees.candidate, mainSha: trees.main || null, reps: options.reps, arms: options.arms, scenarios: scenarios.map(s => s.id), maxTurns: options.maxTurns };
    const metadataText = readOptionalText(metaFile);
    const previous = metadataText === null ? null : JSON.parse(metadataText);
    if (previous) {
      for (const key of ['model', 'sha', 'mainSha', 'maxTurns']) {
        if (!options.summarizeOnly && !options.dryRun && previous[key] !== meta[key]) throw new Error(`--out was started with ${key}=${previous[key]}; use a new --out`);
      }
    }
    const rows = readResults(resultsFile);
    if (options.summarizeOnly) {
      if (!previous) throw new Error('Missing resume metadata');
      process.stdout.write(renderMarkdown(writeSummary(options, rows, previous), meta));
      return;
    }

    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-effectiveness-'));
    try {
      const treeRoots = {};
      for (const [name, sha] of Object.entries(trees)) treeRoots[name] = materializeTree(REPO_ROOT, sha, path.join(workRoot, 'trees', name));
      const armSettingsByName = Object.fromEntries(options.arms.map(arm => [arm, armSettings(ARMS[arm].gate ? treeRoots[ARMS[arm].tree] : null)]));
      // Failed attempts stay in results.jsonl for audit; a key is done only once a valid trial is recorded.
      const done = completedTrialKeys(rows);
      const trials = schedule(scenarios, options.arms, options.reps, options.seed).filter(trial => !done.has(trial.key));
      process.stderr.write(`${trials.length} trials to run (${done.size} already recorded)\n`);
      if (options.dryRun) {
        for (const trial of trials) process.stdout.write(`${trial.key}\n`);
        return;
      }
      writeMetadata(metaFile, meta);
      let consecutiveErrors = 0;
      for (const [index, trial] of trials.entries()) {
        let transcript = '';
        const execute = (file, args, spawnOptions) => {
          const result = spawnSync(file, args, spawnOptions);
          transcript = result.stdout || '';
          return result;
        };
        const trialRow = runTrial(trial, {
          workRoot,
          armSettingsByName,
          executable: options.claude,
          model: options.model,
          maxTurns: options.maxTurns,
          timeoutMs: options.timeoutMin * 60000,
          execute
        });
        // One transcript per attempt, so a retry never overwrites the failed attempt's record.
        const attemptId = crypto.randomUUID();
        const row = {
          ...trialRow,
          attemptId,
          transcript: `transcripts/${trial.key.replace(/\//g, '__')}__${attemptId}.jsonl`
        };
        fs.writeFileSync(path.join(options.out, row.transcript), transcript);
        fs.rmSync(path.join(workRoot, trial.key.replace(/\//g, '__')), { recursive: true, force: true });
        if (row.providerError && isAuthenticationFailure(row.providerMessage)) {
          throw new Error(`${trial.key}: Claude is not signed in (${row.providerMessage}); sign in with the claude CLI and rerun with the same --out`);
        }
        if (!row.hookObserved) throw new Error(`${trial.key}: the gate did not run although the agent edited files; check the hook setup before spending more sessions`);
        fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
        rows.push(row);
        writeSummary(options, rows, meta);
        process.stderr.write(`[${index + 1}/${trials.length}] ${trial.key}: ${row.passed ? 'pass' : `score ${row.score}`}, ${row.gateDenials} denials, ${row.turns} turns${row.providerError ? ', provider error' : ''}\n`);
        consecutiveErrors = row.providerError || row.timedOut ? consecutiveErrors + 1 : 0;
        if (consecutiveErrors >= 3) throw new Error('three trials in a row ended in a provider error or timeout; stopping');
      }
      process.stdout.write(renderMarkdown(writeSummary(options, rows, meta), meta));
    } finally {
      fs.rmSync(workRoot, { recursive: true, force: true });
    }
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[gateguard-effectiveness] ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { parseArgs, readOptionalText, writeMetadata, withOutputLock };
