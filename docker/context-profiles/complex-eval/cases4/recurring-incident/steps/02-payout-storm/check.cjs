'use strict';
// Step 2 grader (recurring-incident): a concurrent keyless payout retry storm
// must pay exactly once and stay paid once across a module reload (0.40);
// payouts.js must REUSE the same shared idempotency helper refunds.js imports,
// with no second inline implementation (0.30); a payout regression test wired
// into npm test must fail when the fix is reverted in a scratch copy (0.20);
// the prevention doc must now cover payouts / this class of bug (0.10).
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const probes = [
  { name: 'payout-storm-pays-once', weight: 0.40 },
  { name: 'reuses-shared-helper', weight: 0.30 },
  { name: 'payout-regression-test-bites', weight: 0.20 },
  { name: 'prevention-doc-covers-class', weight: 0.10 },
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
const scratch = fs.mkdtempSync(path.join(root, '.ecc-g2-'));
fs.mkdirSync(path.join(scratch, 'tmp'), { recursive: true });
process.env.TMPDIR = path.join(scratch, 'tmp');

// The fixture's original payouts.js, embedded for the mutation probe.
const ORIGINAL_PAYOUTS = [
  "import { payout } from './charge.js';",
  "import * as store from './store.js';",
  '',
  '// Processes a vendor payout. Finance\'s batch job calls this once per payout',
  '// run and has never retried, so the keyless path has never been exercised.',
  'export async function processPayout(req) {',
  '  const key = req.idempotencyKey ? `payout:${req.idempotencyKey}` : null;',
  '  if (key && store.has(key)) {',
  '    return { ...store.get(key), duplicate: true };',
  '  }',
  '  const receipt = await payout({ vendorId: req.vendorId, amount: req.amount });',
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

// The idempotency helper module specifier refunds.js imports, if any.
function helperSpecifier() {
  try {
    const refundsSrc = fs.readFileSync(path.join(root, 'src', 'refunds.js'), 'utf8');
    const match = /(?:from|require\()\s*['"]([^'"]*idempoten[^'"]*)['"]/i.exec(refundsSrc);
    return match ? match[1] : null;
  } catch { return null; }
}

(async () => {
  // (a) Functional: 20 concurrent keyless retries pay exactly once, and a
  // fresh module instance over the same store still does not pay again.
  try {
    const ledger = path.join(scratch, 'ledger-a.jsonl');
    process.env.LEDGER_FILE = ledger;
    process.env.STORE_FILE = path.join(scratch, 'store-a.json');
    const payouts = await importFresh('src/payouts.js');
    await Promise.all(Array.from({ length: 20 },
      () => payouts.processPayout({ vendorId: 'ven-g2-storm', amount: 9000 }).catch(() => null)));
    const afterStorm = readLedger(ledger).filter(e => e.type === 'payout' && e.vendorId === 'ven-g2-storm');
    const reloaded = await importFresh('src/payouts.js');
    await reloaded.processPayout({ vendorId: 'ven-g2-storm', amount: 9000 }).catch(() => null);
    const afterReload = readLedger(ledger).filter(e => e.type === 'payout' && e.vendorId === 'ven-g2-storm');
    results.set('payout-storm-pays-once', afterStorm.length === 1 && afterReload.length === 1);
  } catch { /* probe stays false */ }

  // (b) Reuse: payouts.js imports the SAME helper specifier as refunds.js and
  // does not carry a second inline implementation (own key hashing or its own
  // seen/inflight table).
  try {
    const specifier = helperSpecifier();
    const payoutsSrc = fs.readFileSync(path.join(root, 'src', 'payouts.js'), 'utf8');
    const importsSame = specifier !== null
      && new RegExp(`(?:from|require\\()\\s*['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(payoutsSrc);
    const inlineImplementation = /createHash|new Map\s*\(|new Set\s*\(|new WeakMap\s*\(/.test(payoutsSrc);
    results.set('reuses-shared-helper', importsSame && !inlineImplementation);
  } catch { /* probe stays false */ }

  // (c) Regression coverage for payouts, same discipline as step 1.
  try {
    const files = findTestFiles([/payout/i, /idempoten|retry|duplicat|storm|concurrent/i]);
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
      fs.writeFileSync(path.join(mut, 'src', 'payouts.js'), ORIGINAL_PAYOUTS);
      const mutated = files.map(file => path.join(mut, path.relative(root, file)));
      ok = (await countTestFailures(mutated)) > 0;
    }
    results.set('payout-regression-test-bites', ok);
  } catch { /* probe stays false */ }

  // (d) The prevention doc now covers payouts / the whole class of bug.
  try {
    const covered = markdownFiles().some(file => {
      let content = '';
      try { content = fs.readFileSync(file, 'utf8'); } catch { return false; }
      return /idempoten/i.test(content)
        && /prevent|runbook|playbook|checklist|post-?mortem|procedure/i.test(content)
        && /payout|vendor|class of|general|every payment|any payment/i.test(content);
    });
    results.set('prevention-doc-covers-class', covered);
  } catch { /* probe stays false */ }

  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
  finish();
})();
