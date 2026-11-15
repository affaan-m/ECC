'use strict';
// Step 3 grader (recurring-incident): the handoff note. A handoff doc must
// exist (0.20); every file path it references must actually exist in the
// workspace, with at least two concrete references (0.30); it must name the
// shared idempotency helper and describe the prevention procedure (0.30); it
// must cover both the refunds and the payouts incidents (0.20). Scored on the
// best candidate when several handoff files exist.
const fs = require('node:fs');
const path = require('node:path');

const probes = [
  { name: 'handoff-exists', weight: 0.20 },
  { name: 'referenced-paths-exist', weight: 0.30 },
  { name: 'names-helper-and-procedure', weight: 0.30 },
  { name: 'covers-both-incidents', weight: 0.20 },
];
const results = new Map();
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  let score = 0;
  for (const probe of probes) {
    const ok = results.get(probe.name) === true;
    if (ok) score += probe.weight;
    process.stdout.write(`${ok ? 'ok' : 'not ok'} - ${probe.name}\n`);
  }
  process.stdout.write(`ECC_EVAL_SCORE ${JSON.stringify({ score: Math.round(score * 1000) / 1000 })}\n`);
  process.exit(0);
}
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);

const root = process.cwd();

function handoffFiles() {
  const found = [];
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/hand[ -]?off/i.test(entry.name) && /\.(md|markdown|txt)$/i.test(entry.name)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

// Candidate file paths mentioned in prose: at least one path segment and a
// file extension (src/refunds.js, docs/runbooks/idempotency.md, ...).
function referencedPaths(content) {
  const tokens = new Set();
  for (const match of content.matchAll(/(?:[\w@+.-]+\/)+[\w@+.-]+\.[a-z0-9]{1,8}/gi)) {
    const token = match[0].replace(/[.,;:'")\]`]+$/, '').replace(/^[^\w@+.-]+/, '');
    if (token.includes('..') || /^https?/i.test(token)) continue;
    tokens.add(token);
  }
  return [...tokens];
}

function helperBasename() {
  try {
    const refundsSrc = fs.readFileSync(path.join(root, 'src', 'refunds.js'), 'utf8');
    const match = /(?:from|require\()\s*['"]([^'"]*idempoten[^'"]*)['"]/i.exec(refundsSrc);
    return match ? path.basename(match[1]) : null;
  } catch { return null; }
}

function scoreCandidate(content) {
  const verdicts = new Map();
  verdicts.set('handoff-exists', true);

  const paths = referencedPaths(content);
  verdicts.set('referenced-paths-exist', paths.length >= 2
    && paths.every(token => fs.existsSync(path.join(root, token))));

  const helper = helperBasename();
  verdicts.set('names-helper-and-procedure', helper !== null
    && content.includes(helper)
    && /prevent|runbook|playbook|checklist|regression|npm test|procedure/i.test(content));

  verdicts.set('covers-both-incidents', /refund/i.test(content) && /payout/i.test(content));
  return verdicts;
}

try {
  const candidates = handoffFiles();
  if (candidates.length > 0) {
    let best = null;
    for (const file of candidates) {
      let content = '';
      try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const verdicts = scoreCandidate(content);
      const total = [...verdicts.values()].filter(Boolean).length;
      if (!best || total > best.total) best = { verdicts, total };
    }
    if (best) for (const [name, ok] of best.verdicts) results.set(name, ok);
  }
} catch { /* everything stays false */ }

finish();
