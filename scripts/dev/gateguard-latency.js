#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK_FILE = path.join(REPO_ROOT, 'scripts', 'hooks', 'gateguard-fact-force.js');
const DEFAULT_BASELINE = 'upstream/main';
const DEFAULT_RUNS = 30;
const BOOTSTRAP_ROUNDS = 4000;

// --- statistics ---

/** Linear-interpolated quantile of a numeric sample. */
function quantile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

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

/** 95% percentile-bootstrap interval of quantile(b, p) - quantile(a, p); deterministic for a given seed. */
function bootstrapDifference(a, b, p, { rounds = BOOTSTRAP_ROUNDS, seed = 0x9e3779b9 } = {}) {
  const random = xorshift(seed);
  const resample = values => values.map(() => values[random(values.length)]);
  const differences = [];
  for (let i = 0; i < rounds; i++) differences.push(quantile(resample(b), p) - quantile(resample(a), p));
  differences.sort((x, y) => x - y);
  return [differences[Math.floor(rounds * 0.025)], differences[Math.ceil(rounds * 0.975) - 1]];
}

function verdict([low, high]) {
  if (low > 0) return 'slower';
  if (high < 0) return 'faster';
  return 'no measurable change';
}

// --- fixture ---

function buildFixture(workDir) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(workDir, 'project-')));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'widget.js'), 'function widgetValue(x) {\n  return x;\n}\n// note\n'.repeat(50));
  let big = '';
  for (let i = 0; i < 4000; i++) {
    big += `// helper ${i}\nfunction helper${i}(a, b) {\n  const s = "value ${i}"; /* note */\n  return a + b * ${i};\n}\n`;
  }
  fs.writeFileSync(path.join(root, 'src', 'big.js'), `${big}function target(x) {\n  return x;\n}\n`);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Rules\n\n- be careful\n');
  const transcript = path.join(root, 'session.jsonl');
  const records = [{ type: 'user', uuid: 'u1', promptId: 'p1', message: { role: 'user', content: 'fix the widget' } }];
  for (let i = 0; i < 20; i++) {
    records.push({
      type: 'assistant',
      uuid: `a${i}`,
      message: { id: `m${i}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: `rg -g '!*.md' other${i} .` } }] }
    });
    records.push({ type: 'user', uuid: `r${i}`, promptId: 'p1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'ok' }] } });
  }
  fs.writeFileSync(transcript, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
  const base = { session_id: 'latency', transcript_path: transcript, cwd: root, hook_event_name: 'PreToolUse', tool_use_id: 'pending' };
  const edit = (file, oldString, newString, extra = {}) => ({
    ...base,
    tool_name: 'Edit',
    tool_input: { file_path: path.join(root, file), old_string: oldString, new_string: newString, ...extra }
  });
  const bash = command => ({ ...base, tool_name: 'Bash', tool_input: { command } });
  const cases = [
    ['Shell command, first of session', bash('npm test'), []],
    ['Shell command, routine gate passed', bash('npm run build'), [bash('npm test')]],
    ['Edit of a file already checked', edit('src/widget.js', '  return x;', '  return x + 1;'), [edit('src/widget.js', '  return x;', '  return x + 1;')]],
    ['First edit, code, denied', edit('src/widget.js', '  return x;', '  return x + 1;'), []],
    ['First edit, comment-only pass', edit('src/widget.js', '// note', '// note!', { replace_all: true }), []],
    ['First edit, CLAUDE.md, denied', edit('CLAUDE.md', '- be careful', '- be very careful'), []],
    ['First edit, 406 KiB file, denied', edit('src/big.js', '  return x;', '  return x + 1;'), []]
  ];
  return { root, cases };
}

// --- measurement ---

const SETUP_PROBE = 'const hook = require(process.argv[1]); for (const step of JSON.parse(process.argv[2])) hook.run(JSON.stringify(step));';
const TIMED_PROBE = [
  "const { performance } = require('perf_hooks');",
  'const started = performance.now();',
  'require(process.argv[1]).run(process.argv[2]);',
  'process.stdout.write(String(performance.now() - started));'
].join('\n');

function sampleOnce(hookFile, payload, setup, root, workDir) {
  const stateDir = fs.mkdtempSync(path.join(workDir, 'state-'));
  try {
    const env = { PATH: process.env.PATH || '', HOME: root, USERPROFILE: root, GATEGUARD_STATE_DIR: stateDir, CLAUDE_PROJECT_DIR: root };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (setup.length > 0) execFileSync(process.execPath, ['-e', SETUP_PROBE, hookFile, JSON.stringify(setup)], { env, stdio: 'ignore' });
    return Number(execFileSync(process.execPath, ['-e', TIMED_PROBE, hookFile, JSON.stringify(payload)], { env, encoding: 'utf8' }));
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

/** Fresh-process require()+run() samples per call type and hook, interleaved in a shuffled order each round. */
function measure(hooks, { runs = DEFAULT_RUNS, seed = 7, onRound = () => {} } = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-latency-'));
  try {
    const { root, cases } = buildFixture(workDir);
    const random = xorshift(seed);
    const samples = Object.fromEntries(cases.map(([name]) => [name, Object.fromEntries(hooks.map(hook => [hook.label, []]))]));
    for (let round = 0; round < runs; round++) {
      for (const [name, payload, setup] of cases) {
        const order = hooks.slice();
        for (let i = order.length - 1; i > 0; i--) {
          const j = random(i + 1);
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (const hook of order) samples[name][hook.label].push(sampleOnce(hook.file, payload, setup, root, workDir));
      }
      onRound(round + 1);
    }
    return samples;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** p50/p90 per hook and the bootstrap interval of each baseline-to-working-tree difference. */
function summarize(samples, labels) {
  const [working, ...baselines] = labels;
  return Object.entries(samples).map(([name, byHook]) => ({
    name,
    quantiles: Object.fromEntries(labels.map(label => [label, { p50: quantile(byHook[label], 0.5), p90: quantile(byHook[label], 0.9) }])),
    comparisons: baselines.map(baseline => {
      const p50 = bootstrapDifference(byHook[baseline], byHook[working], 0.5);
      const p90 = bootstrapDifference(byHook[baseline], byHook[working], 0.9);
      return { baseline, p50, p90, p50Verdict: verdict(p50), p90Verdict: verdict(p90) };
    })
  }));
}

function renderMarkdown(rows, labels, runs) {
  const fmt = value => value.toFixed(1);
  const lines = [
    `${runs} fresh processes per call type and hook, interleaved; require() + run() in ms; 95% bootstrap intervals of the working tree minus the baseline.`,
    '',
    `| Call | ${labels.map(label => `${label} p50 / p90`).join(' | ')} |`,
    `| --- | ${labels.map(() => '---:').join(' | ')} |`,
    ...rows.map(row => `| ${row.name} | ${labels.map(label => `${fmt(row.quantiles[label].p50)} / ${fmt(row.quantiles[label].p90)}`).join(' | ')} |`),
    ''
  ];
  for (const baseline of labels.slice(1)) {
    lines.push(`| Call | p50 change vs ${baseline} | p90 change vs ${baseline} |`, '| --- | --- | --- |');
    for (const row of rows) {
      const c = row.comparisons.find(entry => entry.baseline === baseline);
      lines.push(`| ${row.name} | [${fmt(c.p50[0])}, ${fmt(c.p50[1])}] ${c.p50Verdict} | [${fmt(c.p90[0])}, ${fmt(c.p90[1])}] ${c.p90Verdict} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

// --- CLI ---

const USAGE = [
  'Usage: node scripts/dev/gateguard-latency.js [--baseline <ref>]... [--runs <n>] [--json]',
  '',
  '  --baseline <ref>  git ref whose hook is compared with the working tree (repeatable;',
  `                    default ${DEFAULT_BASELINE})`,
  `  --runs <n>        fresh processes per call type and hook (default ${DEFAULT_RUNS})`,
  '  --json            print samples and summary as JSON'
].join('\n');

function parseArgs(argv) {
  const options = { baselines: [], runs: DEFAULT_RUNS, format: 'markdown', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.format = 'json';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--baseline' && i + 1 < argv.length) options.baselines.push(argv[++i]);
    else if (arg === '--runs' && i + 1 < argv.length && /^[1-9]\d*$/.test(argv[i + 1])) options.runs = Number(argv[++i]);
    else throw new Error(`unknown or incomplete argument: ${arg}\n\n${USAGE}`);
  }
  if (options.baselines.length === 0) options.baselines.push(DEFAULT_BASELINE);
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const { materializeHook } = require('./gateguard-eval');
  const materialized = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-latency-hooks-'));
  try {
    const hooks = [{ label: 'working tree', file: HOOK_FILE }].concat(
      options.baselines.map((ref, index) => ({ label: ref, file: materializeHook(ref, path.join(materialized, String(index))) }))
    );
    const samples = measure(hooks, { runs: options.runs, onRound: round => process.stderr.write(`\rround ${round}/${options.runs}`) });
    process.stderr.write('\n');
    const labels = hooks.map(hook => hook.label);
    const rows = summarize(samples, labels);
    process.stdout.write(options.format === 'json' ? `${JSON.stringify({ runs: options.runs, samples, rows }, null, 2)}\n` : `${renderMarkdown(rows, labels, options.runs)}\n`);
  } finally {
    fs.rmSync(materialized, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[gateguard-latency] ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { quantile, bootstrapDifference, verdict, summarize, measure, parseArgs };
