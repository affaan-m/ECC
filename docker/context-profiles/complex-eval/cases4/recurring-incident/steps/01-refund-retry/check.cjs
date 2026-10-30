'use strict';
// Step 1 grader (recurring-incident): a refund retried WITHOUT an idempotency
// key must refund exactly once — in-process (0.20) and across a module reload
// with the same store (0.20); a regression test wired into `npm test` must fail
// when the fix is reverted in a scratch copy (0.30); a durable prevention doc
// must exist (0.20); the mechanism must live in a shared helper module (0.10).
// Graders cannot spawn child processes (--permission), so tests are executed
// in-process via node:test's run({ isolation: 'none' }) with TMPDIR redirected
// into the workspace.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const probes = [
  { name: 'retry-same-process-refunds-once', weight: 0.20 },
  { name: 'retry-after-reload-refunds-once', weight: 0.20 },
  { name: 'regression-test-wired-and-bites', weight: 0.30 },
  { name: 'prevention-doc-exists', weight: 0.20 },
  { name: 'shared-idempotency-helper', weight: 0.10 },
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
const scratch = fs.mkdtempSync(path.join(root, '.ecc-g1-'));
fs.mkdirSync(path.join(scratch, 'tmp'), { recursive: true });
process.env.TMPDIR = path.join(scratch, 'tmp');

// The fixture's original buggy refunds.js, embedded so the mutation probe can
// revert the fix in a scratch copy and check the regression suite notices.
const ORIGINAL_REFUNDS = [
  "import { refund } from './charge.js';",
  "import * as store from './store.js';",
  '',
  '// Processes a customer refund. Callers that have one pass an idempotencyKey;',
  '// plenty of callers (the storefront retry loop among them) do not.',
  'export async function processRefund(req) {',
  '  const key = req.idempotencyKey ? `refund:${req.idempotencyKey}` : null;',
  '  if (key && store.has(key)) {',
  '    return { ...store.get(key), duplicate: true };',
  '  }',
  '  const receipt = await refund({ orderId: req.orderId, amount: req.amount });',
  '  if (key) store.set(key, receipt);',
  '  return receipt;',
  '}',
  '',
].join('\n');

let importCounter = 0;
function importFresh(relative) {
  importCounter += 1;
  return import(`${pathToFileURL(path.join(root, relative)).href}?cb=${importCounter}`);
}

function readLedger(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(line => line.trim()).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(path.join(from, entry.name), target);
    else if (entry.isFile()) fs.copyFileSync(path.join(from, entry.name), target);
  }
}

function findTestFiles(mustMatch) {
  const found = [];
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.test\.(js|cjs|mjs)$/.test(entry.name)) continue;
      let content = '';
      try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (mustMatch.every(re => re.test(content))) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

function npmTestWired() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const script = (pkg.scripts && pkg.scripts.test) || '';
    // `node --test test/` silently runs nothing on Node 24; that is not wired.
    return /--test\b/.test(script) && !/--test\s+test\/?\s*$/.test(script.trim());
  } catch { return false; }
}

async function countTestFailures(files) {
  const { run } = require('node:test');
  let failures = 0;
  const stream = run({ files, isolation: 'none', concurrency: 1 });
  stream.on('test:fail', () => { failures += 1; });
  await new Promise((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject); stream.resume(); });
  return failures;
}

function markdownFiles() {
  const found = [];
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|markdown|txt)$/i.test(entry.name)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

function isPreventionDoc(file) {
  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { return false; }
  return /idempoten/i.test(content) && /prevent|runbook|playbook|checklist|post-?mortem|procedure/i.test(content);
}

(async () => {
  // (a) Functional: a keyless refund retried in-process refunds exactly once.
  try {
    const ledger = path.join(scratch, 'ledger-a.jsonl');
    process.env.LEDGER_FILE = ledger;
    process.env.STORE_FILE = path.join(scratch, 'store-a.json');
    const refunds = await importFresh('src/refunds.js');
    await refunds.processRefund({ orderId: 'ord-g1-retry', amount: 2500 });
    await refunds.processRefund({ orderId: 'ord-g1-retry', amount: 2500 });
    const entries = readLedger(ledger).filter(e => e.type === 'refund' && e.orderId === 'ord-g1-retry');
    results.set('retry-same-process-refunds-once', entries.length === 1);

    // (a2) Durable: a fresh module instance (simulated restart) over the same
    // store must still not refund again.
    const reloaded = await importFresh('src/refunds.js');
    await reloaded.processRefund({ orderId: 'ord-g1-retry', amount: 2500 });
    const afterReload = readLedger(ledger).filter(e => e.type === 'refund' && e.orderId === 'ord-g1-retry');
    results.set('retry-after-reload-refunds-once', entries.length === 1 && afterReload.length === 1);
  } catch { /* both functional probes stay false */ }

  // (b) Regression coverage: a refund/idempotency test exists, npm test is
  // wired, the suite passes as-is, and it FAILS when the fix is reverted.
  try {
    const files = findTestFiles([/refund/i, /idempoten|retry|duplicat/i]);
    let ok = files.length > 0 && npmTestWired();
    if (ok) ok = (await countTestFailures(files)) === 0;
    if (ok) {
      const mut = path.join(scratch, 'mutation');
      fs.mkdirSync(mut, { recursive: true });
      copyTree(path.join(root, 'src'), path.join(mut, 'src'));
      fs.copyFileSync(path.join(root, 'package.json'), path.join(mut, 'package.json'));
      for (const file of files) {
        const target = path.join(mut, path.relative(root, file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
      }
      fs.writeFileSync(path.join(mut, 'src', 'refunds.js'), ORIGINAL_REFUNDS);
      const mutated = files.map(file => path.join(mut, path.relative(root, file)));
      ok = (await countTestFailures(mutated)) > 0;
    }
    results.set('regression-test-wired-and-bites', ok);
  } catch { /* probe stays false */ }

  // (c) A durable prevention artifact: some doc ties idempotency to a
  // prevention procedure (runbook/playbook/checklist/postmortem).
  try {
    results.set('prevention-doc-exists', markdownFiles().some(isPreventionDoc));
  } catch { /* probe stays false */ }

  // (d) The mechanism lives in a shared helper module that refunds.js imports,
  // not inline in refunds.js alone.
  try {
    const refundsSrc = fs.readFileSync(path.join(root, 'src', 'refunds.js'), 'utf8');
    const helpers = fs.readdirSync(path.join(root, 'src'))
      .filter(name => /idempoten/i.test(name) && /\.(js|cjs|mjs)$/.test(name));
    const imported = /import[^'"]*from\s*['"][^'"]*idempoten[^'"]*['"]/.test(refundsSrc)
      || /require\(\s*['"][^'"]*idempoten[^'"]*['"]\s*\)/.test(refundsSrc);
    results.set('shared-idempotency-helper', helpers.length > 0 && imported);
  } catch { /* probe stays false */ }

  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
  finish();
})();
