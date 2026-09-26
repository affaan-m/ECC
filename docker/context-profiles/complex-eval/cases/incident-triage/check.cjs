'use strict';
// Hidden grader for incident-triage: checks exact totals on boundary orders and
// the root-cause report. Prints ECC_EVAL_SCORE and always exits 0.
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });

let computeOrderTotal;
try { ({ computeOrderTotal } = require(path.join(process.cwd(), 'src', 'totals.js'))); } catch { /* scored below */ }

// Boundary orders where decimal-factor float math under-rounds by a cent;
// expected values follow the README pricing rules (integer cents, half-up per line).
const boundary = [
  { lines: [{ priceCents: 165, quantity: 1 }], discountPercent: 30, expected: 116 },
  { lines: [{ priceCents: 250, quantity: 1 }], discountPercent: 7, expected: 233 },
  { lines: [{ priceCents: 325, quantity: 1 }], discountPercent: 30, expected: 228 },
  { lines: [{ priceCents: 345, quantity: 1 }], discountPercent: 30, expected: 242 },
  { lines: [{ priceCents: 165, quantity: 1 }, { priceCents: 325, quantity: 1 }], discountPercent: 30, expected: 344 },
];

if (typeof computeOrderTotal === 'function') {
  boundary.forEach((order, index) => {
    let actual = NaN;
    try { actual = computeOrderTotal({ lines: order.lines, discountPercent: order.discountPercent }); } catch { /* wrong */ }
    record(`boundary-total-${index + 1}`, actual === order.expected);
  });
  let plain = NaN;
  try { plain = computeOrderTotal({ lines: [{ priceCents: 1000, quantity: 2 }], discountPercent: 0 }); } catch { /* wrong */ }
  record('undiscounted-total-unchanged', plain === 2000);
} else {
  for (let index = 0; index < boundary.length; index++) record(`boundary-total-${index + 1}`, false);
  record('undiscounted-total-unchanged', false);
}

let incident = '';
try { incident = fs.readFileSync(path.join(process.cwd(), 'INCIDENT.md'), 'utf8'); } catch { /* missing */ }
record('incident-identifies-C-2', /C-2/.test(incident));
record('incident-explains-rounding', /round|float|decimal|cent/i.test(incident));

const ok = checks.filter(c => c.ok).length;
for (const c of checks) console.log(`${c.ok ? 'ok' : 'not ok'} - ${c.name}`);
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: ok / checks.length, passed: ok, total: checks.length })}`);
process.exit(0);
