#!/usr/bin/env node
'use strict';

// Hidden-intent effectiveness run.
//
// Separate from run.js on purpose: run.js measures the gate's cost in one-shot
// autonomous sessions and remains the cost baseline. This runner measures
// whether the gate's questions obtain a fact the repository does not hold, and
// reports the holes rather than asserting coverage.

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { schedule } = require('./lib');
const { ARMS, armSettings, resolveRef, materializeTree } = require('./arms');
const { loadIntentScenarios, graderIsSound, runIntentTrial, SUPPORTED_ARMS } = require('./intent-eval');
const { renderHoles, difficulty, isValidTrial } = require('./coverage');
const evidence = require('./evidence');

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
  '  --summarize             rebuild the report from results.jsonl',
  '  --verify                verify evidence.json checksums and exit'
].join('\n');

function parseArgs(argv) {
  const options = {
    out: null, model: null, judgeModel: 'haiku', claude: 'claude',
    arms: ['off', 'gate', 'placebo'], scenarios: null, reps: 3, userTurns: 3,
    candidateRef: 'HEAD', mainRef: 'upstream/main', maxTurns: 40, timeoutMin: 15, seed: 11,
    allowRealProvider: false, dryRun: false, summarizeOnly: false, verifyOnly: false, checkGraders: false, help: false
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
    else if (arg === '--verify') options.verifyOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
  }
  const unsupported = options.arms.filter(arm => !SUPPORTED_ARMS.includes(arm));
  if (unsupported.length) throw new Error(`arm not supported for hidden-intent scenarios: ${unsupported.join(', ')}`);
  if (!options.verifyOnly && !options.help && !options.checkGraders &&
      (!options.arms.includes('gate') || options.arms.length < 2)) {
    throw new Error('the effectiveness comparison needs the gate arm and at least one comparator arm');
  }
  if (!options.help && !options.checkGraders && !options.out) throw new Error(`--out is required\n\n${USAGE}`);
  if (!options.help && !options.checkGraders && !options.dryRun && !options.summarizeOnly && !options.verifyOnly) {
    if (!options.model) throw new Error(`--model is required\n\n${USAGE}`);
    if (!options.allowRealProvider) throw new Error(`real sessions need --allow-real-provider\n\n${USAGE}`);
  }
  return options;
}

function readResults(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').flatMap((line, index) => {
    if (!line) return [];
    try {
      return [JSON.parse(line)];
    } catch (error) {
      throw new Error(`results.jsonl line ${index + 1} is malformed; preserve the file for recovery (${error.message})`);
    }
  });
}

function writeAtomic(file, contents) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function completedTrialKeys(rows) {
  return new Set(rows.filter(isValidTrial).map(row => row.key));
}

// Resuming a session needs persistence, so Claude writes a transcript folder per
// trial workspace under its projects directory. A per-trial CLAUDE_CONFIG_DIR
// would isolate those but also hides the credentials, so they are removed here
// instead. Only folders this run created, named after its own temp work root,
// are touched.
function sessionsDir() {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(home, 'projects');
}

function listSessions() {
  try {
    return new Set(fs.readdirSync(sessionsDir()));
  } catch (_) {
    return new Set();
  }
}

function removeTrialSessions(before) {
  const dir = sessionsDir();
  for (const entry of listSessions()) {
    if (before.has(entry) || !entry.includes('gateguard-intent')) continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function writeReport(options, rows, meta) {
  const header = `Model: ${meta.model}; judge: ${meta.judgeModel}; hook commit: ${meta.sha}; reps: ${meta.reps}; user turns: ${meta.userTurns}.\n\n`;
  const configuration = meta.configuration;
  const expectedTrials = configuration
    ? schedule(configuration.scenarios.map(id => ({ id })), configuration.arms, configuration.reps, configuration.seed)
    : [];
  const validKeys = new Set(rows.filter(isValidTrial).map(row => row.key));
  const body = configuration
    ? renderHoles(rows, { expectedTrialKeys: expectedTrials.map(trial => trial.key) })
    : rows.length ? renderHoles(rows) : 'No trials recorded yet.\n';
  writeAtomic(path.join(options.out, 'holes.md'), header + body);
  writeAtomic(
    path.join(options.out, 'summary.json'),
    `${JSON.stringify({
      meta,
      difficulty: difficulty(rows.filter(isValidTrial)),
      rows: rows.length,
      expectedTrials: expectedTrials.length || null,
      validScheduledTrials: validKeys.size,
      complete: expectedTrials.length ? validKeys.size === expectedTrials.length : null,
      validRows: rows.filter(isValidTrial).length,
      invalidRows: rows.filter(row => !isValidTrial(row)).length
    }, null, 2)}\n`
  );
  writeAtomic(
    path.join(options.out, 'evidence.json'),
    `${JSON.stringify(evidence.buildManifest({
      meta,
      configuration: meta.configuration,
      scenarioFingerprints: meta.scenarioFingerprints,
      sourceFingerprints: meta.sourceFingerprints,
      outDir: options.out,
      rows
    }), null, 2)}\n`
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
  if (options.verifyOnly) {
    const manifest = evidence.verifyManifest(options.out);
    process.stdout.write(`Evidence verified: ${Object.keys(manifest.files).length} artifact(s), schema ${manifest.schemaVersion}.\n`);
    return;
  }
  const savedMetaFile = options.out && path.join(options.out, 'meta.json');
  if (options.summarizeOnly && savedMetaFile && fs.existsSync(savedMetaFile)) {
    const saved = JSON.parse(fs.readFileSync(savedMetaFile, 'utf8'));
    const config = saved.configuration;
    if (config) Object.assign(options, {
      model: config.model, judgeModel: config.judgeModel, arms: config.arms,
      scenarios: config.scenarios, reps: config.reps, userTurns: config.userTurns,
      maxTurns: config.maxTurns, timeoutMin: config.timeoutMin, seed: config.seed
    });
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
  const configuration = {
    model: options.model, judgeModel: options.judgeModel, candidateSha: trees.candidate, mainSha: trees.main || null,
    reps: options.reps, userTurns: options.userTurns, arms: options.arms, scenarios: scenarios.map(scenario => scenario.id),
    maxTurns: options.maxTurns, timeoutMin: options.timeoutMin, seed: options.seed
  };
  const meta = {
    model: options.model, judgeModel: options.judgeModel, sha: trees.candidate, mainSha: trees.main || null,
    reps: options.reps, userTurns: options.userTurns, arms: options.arms,
    scenarios: scenarios.map(scenario => scenario.id), maxTurns: options.maxTurns, timeoutMin: options.timeoutMin,
    seed: options.seed, configuration,
    scenarioFingerprints: Object.fromEntries(scenarios.map(scenario => [scenario.id, evidence.hashDirectory(scenario.root)])),
    sourceFingerprints: Object.fromEntries([
      'run-intent.js', 'coverage.js', 'intent-eval.js', 'lib.js', 'session.js', 'user-sim.js', 'arms.js', 'evidence.js',
      '../context-profiles/ai-eval-lib.js'
    ].map(name => [name, evidence.hashFile(path.resolve(__dirname, name))]))
  };
  if (fs.existsSync(metaFile)) {
    const previous = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (!options.summarizeOnly && !options.dryRun && (
      JSON.stringify(previous.configuration) !== JSON.stringify(configuration) ||
      JSON.stringify(previous.scenarioFingerprints) !== JSON.stringify(meta.scenarioFingerprints) ||
      JSON.stringify(previous.sourceFingerprints) !== JSON.stringify(meta.sourceFingerprints)
    )) {
      throw new Error('--out was started with a different experiment configuration; use a new --out');
    }
  }
  const rows = readResults(resultsFile);
  const planned = schedule(scenarios, options.arms, options.reps, options.seed);
  evidence.validateRows(rows, planned);
  if (options.summarizeOnly) {
    const previous = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (JSON.stringify(previous.scenarioFingerprints) !== JSON.stringify(meta.scenarioFingerprints) ||
        JSON.stringify(previous.sourceFingerprints) !== JSON.stringify(meta.sourceFingerprints)) {
      throw new Error('--summarize cannot use changed scenario or harness inputs; preserve the original run inputs or use a new --out');
    }
    process.stdout.write(writeReport(options, rows, previous));
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
    // Failed attempts remain in results.jsonl for audit, but the scheduled key
    // is complete only after a valid trial has been recorded.
    const done = completedTrialKeys(rows);
    const trials = planned.filter(trial => !done.has(trial.key));
    process.stderr.write(`${trials.length} trials to run (${done.size} already recorded)\n`);
    if (options.dryRun) {
      for (const trial of trials) process.stdout.write(`${trial.key}\n`);
      return;
    }
    writeAtomic(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    let judgeFailures = 0;
    for (const [index, trial] of trials.entries()) {
      const sessionsBefore = listSessions();
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
      const attemptId = crypto.randomUUID();
      const transcriptName = `${trial.key.replace(/\//g, '__')}__${attemptId}.jsonl`;
      row.attemptId = attemptId;
      row.transcript = `transcripts/${transcriptName}`;
      fs.writeFileSync(
        path.join(options.out, row.transcript),
        transcript.join('\n')
      );
      row.transcriptSha256 = evidence.hashFile(path.join(options.out, row.transcript));
      fs.rmSync(path.join(workRoot, trial.key.replace(/\//g, '__')), { recursive: true, force: true });
      removeTrialSessions(sessionsBefore);
      // An unauthenticated or hookless run must not be recorded: graded as data it
      // looks like a finding (the first such trial was filed as a coverage hole).
      if (row.providerError && /authenticat|log ?in|oauth/i.test(row.providerMessage || '')) {
        throw new Error(`${trial.key}: Claude is not signed in (${row.providerMessage}); sign in with the claude CLI and rerun with the same --out`);
      }
      if (!row.hookObserved) {
        throw new Error(`${trial.key}: the gate did not run although the agent edited files; check the hook setup before spending more sessions`);
      }
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

module.exports = { parseArgs, writeReport, checkGraders, completedTrialKeys, writeAtomic };
