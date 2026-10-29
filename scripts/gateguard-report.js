#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { METRICS_FILE_NAME, isMetricsEvent } = require('./lib/gateguard-metrics');

const DENIAL_DECISIONS = new Set(['deny', 'routine-deny', 'destructive-deny']);
const FIRST_TOUCH_DECISIONS = ['deny', 'credit', 'sibling', 'cap', 'trivial'];
const NEAR_MISS_PREFIX = 'near-miss:';
const TOP_QUESTIONS = 10;

function showHelp() {
  console.log(`
Usage: node scripts/gateguard-report.js [options]

Summarises GateGuard decision metrics (written when GATEGUARD_METRICS=1).

Options:
  --dir <path>  Directory holding metrics.jsonl (default: GATEGUARD_STATE_DIR or ~/.gateguard)
  --json        Emit machine-readable JSON
  --help        Show this help text
`);
}

function parseArgs(argv) {
  const options = { dir: null, json: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --dir');
      options.dir = value;
      index++;
    } else if (arg.startsWith('--dir=')) {
      const value = arg.slice('--dir='.length);
      if (!value) throw new Error('Missing value for --dir');
      options.dir = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function defaultDir() {
  return process.env.GATEGUARD_STATE_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gateguard');
}

/** Valid events from `metrics.jsonl.1` then `metrics.jsonl` in `dir`, with the count of skipped lines. */
function loadMetrics(dir) {
  const current = path.join(dir, METRICS_FILE_NAME);
  const files = [`${current}.1`, current].filter(file => {
    try {
      return fs.statSync(file).isFile();
    } catch (_) {
      return false;
    }
  });
  const events = [];
  let skipped = 0;
  for (const file of files) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch (_) {
        parsed = null;
      }
      if (isMetricsEvent(parsed)) {
        events.push(parsed);
      } else {
        skipped++;
      }
    }
  }
  return { dir, files, events, skipped };
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function byCount(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0)));
}

function ratio(count, total) {
  return total > 0 ? count / total : null;
}

function summarizeGroup(events) {
  const decisions = {};
  const denialClasses = {};
  const denialReasons = {};
  const questions = {};
  const firstTouchCounts = Object.fromEntries(FIRST_TOUCH_DECISIONS.map(decision => [decision, 0]));
  let denials = 0;
  let nearMiss = 0;
  for (const event of events) {
    increment(decisions, event.decision);
    if (Object.hasOwn(firstTouchCounts, event.decision)) firstTouchCounts[event.decision]++;
    if (DENIAL_DECISIONS.has(event.decision)) {
      denials++;
      increment(denialClasses, event.class || 'shell');
      increment(denialReasons, event.reason || 'unknown');
    }
    if (event.decision === 'deny') {
      if (typeof event.reason === 'string' && event.reason.startsWith(NEAR_MISS_PREFIX)) nearMiss++;
      for (const id of event.questions || []) increment(questions, id);
    }
  }
  const firstTouchTotal = FIRST_TOUCH_DECISIONS.reduce((sum, decision) => sum + firstTouchCounts[decision], 0);
  return {
    events: events.length,
    first: events.length > 0 ? events[0].ts : null,
    last: events.length > 0 ? events[events.length - 1].ts : null,
    decisions: byCount(decisions),
    denials: { total: denials, byClass: byCount(denialClasses), byReason: byCount(denialReasons) },
    nearMiss: { count: nearMiss, of: firstTouchCounts.deny, share: ratio(nearMiss, firstTouchCounts.deny) },
    firstTouch: {
      total: firstTouchTotal,
      counts: firstTouchCounts,
      rates: Object.fromEntries(FIRST_TOUCH_DECISIONS.map(decision => [decision, ratio(firstTouchCounts[decision], firstTouchTotal)]))
    },
    routineReadonlyPasses: decisions['routine-readonly'] || 0,
    topQuestions: Object.entries(byCount(questions)).slice(0, TOP_QUESTIONS)
  };
}

/** Totals and per-session summaries of metrics events. */
function summarize(events) {
  const bySession = new Map();
  for (const event of events) {
    if (!bySession.has(event.session)) bySession.set(event.session, []);
    bySession.get(event.session).push(event);
  }
  const sessions = {};
  for (const [session, sessionEvents] of bySession) sessions[session] = summarizeGroup(sessionEvents);
  return { total: summarizeGroup(events), sessions };
}

function percent(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function counts(entries) {
  const list = Array.isArray(entries) ? entries : Object.entries(entries);
  return list.length > 0 ? list.map(([key, count]) => `${key} ${count}`).join(', ') : 'none';
}

function formatGroup(title, group) {
  const rates = FIRST_TOUCH_DECISIONS.map(decision => `${decision} ${percent(group.firstTouch.rates[decision])}`).join(', ');
  return [
    title,
    `  decisions: ${counts(group.decisions)}`,
    `  denials: ${group.denials.total}`,
    `  denials by class: ${counts(group.denials.byClass)}`,
    `  denials by reason: ${counts(group.denials.byReason)}`,
    `  near-miss share of first-touch denials: ${percent(group.nearMiss.share)} (${group.nearMiss.count} of ${group.nearMiss.of})`,
    `  first-touch outcomes (${group.firstTouch.total}): ${rates}`,
    `  routine read-only passes: ${group.routineReadonlyPasses}`,
    `  most-asked questions: ${counts(group.topQuestions)}`
  ].join('\n');
}

/** Plain-text report for `loadMetrics` output plus its `summarize` report. */
function formatReport({ dir, events, skipped, report }) {
  const sessionIds = Object.keys(report.sessions);
  const header =
    `GateGuard metrics${dir ? ` in ${dir}` : ''}: ${events.length} events in ${sessionIds.length} sessions` +
    (skipped > 0 ? ` (${skipped} malformed lines skipped)` : '');
  const sections = [header, '', formatGroup('Total', report.total)];
  for (const session of sessionIds) {
    const group = report.sessions[session];
    sections.push('', formatGroup(`Session ${session} (${group.first} to ${group.last})`, group));
  }
  return `${sections.join('\n')}\n`;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      showHelp();
      return;
    }
    const loaded = loadMetrics(options.dir || defaultDir());
    const report = summarize(loaded.events);
    if (options.json) {
      const output = { dir: loaded.dir, files: loaded.files, events: loaded.events.length, skipped: loaded.skipped, ...report };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else if (loaded.events.length === 0) {
      process.stdout.write(
        `No GateGuard metrics in ${loaded.dir}` +
          (loaded.skipped > 0 ? ` (${loaded.skipped} malformed lines skipped)` : '') +
          '. Set GATEGUARD_METRICS=1 to record gate decisions.\n'
      );
    } else {
      process.stdout.write(formatReport({ ...loaded, report }));
    }
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { formatReport, loadMetrics, parseArgs, summarize };
