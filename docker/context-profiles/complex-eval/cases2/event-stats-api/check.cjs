'use strict';
// Hidden grader for event-stats-api: independent spec-conformant aggregation
// over the deterministic event log, plus a measured 2,000-query performance
// probe (threshold calibrated on the grading machine: shipped naive ~7.7s,
// reference ~1.5s). Prints ECC_EVAL_SCORE and always exits 0.
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const ok = checks.filter(c => c.ok).length;
  for (const c of checks) console.log(`${c.ok ? 'ok' : 'not ok'} - ${c.name}`);
  console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: ok / checks.length, passed: ok, total: checks.length })}`);
  process.exit(0);
}
setTimeout(finish, 110000).unref();

const PERF_THRESHOLD_MS = 6000;
const PERF_QUERIES = 2000;

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const root = process.cwd();
const { events, TYPES, EPOCH_MS, SPAN_MS } = require(path.join(root, 'src', 'data.js'));

// Independent reference semantics per the README: inclusive bounds,
// nearest-rank percentiles, half-up two-decimal average via exact integer math.
function expected(type, from, to) {
  const rows = events
    .filter(e => e.type === type && (from === null || e.ts >= from) && (to === null || e.ts <= to))
    .map(e => e.value)
    .sort((a, b) => a - b);
  const count = rows.length;
  if (!count) return { count: 0, sum: 0, avg: null, p50: null, p95: null, p99: null, min: null, max: null };
  const sum = rows.reduce((a, b) => a + b, 0);
  const rank = p => rows[Math.ceil((p / 100) * count) - 1];
  const avgCents = Math.floor((sum * 200 + count) / (count * 2));
  return { count, sum, avg: avgCents / 100,
    p50: rank(50), p95: rank(95), p99: rank(99), min: rows[0], max: rows[count - 1] };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function query(port, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const response = await fetch(`http://127.0.0.1:${port}/stats?${qs}`);
  return { status: response.status, body: await response.json().catch(() => null) };
}

(async () => {
  let createApp;
  try { ({ createApp } = require(path.join(root, 'src', 'app.js'))); } catch { finish(); return; }
  if (typeof createApp !== 'function') { finish(); return; }

  try {
    const app = createApp();
    await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
    const port = app.address().port;

    // 1-2: broad and full-range queries with independently computed expectations.
    const broadFrom = EPOCH_MS;
    const broadTo = EPOCH_MS + 30 * 86400000;
    const broad = await query(port, { type: 'click', from: broadFrom, to: broadTo });
    record('broad-window-exact', broad.status === 200
      && same(broad.body, { type: 'click', from: broadFrom, to: broadTo, ...expected('click', broadFrom, broadTo) }));
    const full = await query(port, { type: 'purchase' });
    record('full-range-exact', full.status === 200
      && same(full.body, { type: 'purchase', from: null, to: null, ...expected('purchase', null, null) }));

    // 3: nearest-rank vs interpolation is distinguishable on a tiny window.
    const exportEvents = events.filter(e => e.type === 'export').map(e => e.ts).sort((a, b) => a - b);
    const pivot = exportEvents[Math.floor(exportEvents.length / 2)];
    const narrowFrom = pivot - 1;
    const narrowTo = pivot + 1;
    const narrow = await query(port, { type: 'export', from: narrowFrom, to: narrowTo });
    record('narrow-window-nearest-rank', narrow.status === 200
      && same(narrow.body, { type: 'export', from: narrowFrom, to: narrowTo, ...expected('export', narrowFrom, narrowTo) }));

    // 4-5: empty range and unknown type return nulls, not zeros or errors.
    const beyond = await query(port, { type: 'click', from: EPOCH_MS + 200 * 86400000, to: EPOCH_MS + 201 * 86400000 });
    record('empty-range-nulls', beyond.status === 200 && same(beyond.body,
      { type: 'click', from: EPOCH_MS + 200 * 86400000, to: EPOCH_MS + 201 * 86400000, ...expected('click', EPOCH_MS + 200 * 86400000, EPOCH_MS + 201 * 86400000) }));
    const unknown = await query(port, { type: 'nope' });
    record('unknown-type-nulls', unknown.status === 200
      && same(unknown.body, { type: 'nope', from: null, to: null, ...expected('nope', null, null) }));

    // 6: inclusive bounds — a zero-width window on a real timestamp includes it.
    const likeTs = events.filter(e => e.type === 'like').map(e => e.ts).sort((a, b) => a - b)[100];
    const inclusive = await query(port, { type: 'like', from: likeTs, to: likeTs });
    record('bounds-inclusive', inclusive.status === 200 && inclusive.body.count === expected('like', likeTs, likeTs).count && inclusive.body.count >= 1);

    // 7: average rounding follows half-up two decimals exactly.
    const rounding = expected('view', EPOCH_MS, EPOCH_MS + 86400000);
    const rounded = await query(port, { type: 'view', from: EPOCH_MS, to: EPOCH_MS + 86400000 });
    record('avg-half-up-2dp', rounded.status === 200 && rounded.body.avg === rounding.avg);

    // 8-9: invalid parameters are 400.
    const inverted = await query(port, { type: 'click', from: 10, to: 5 });
    record('inverted-bounds-400', inverted.status === 400);
    const garbage = await query(port, { type: 'click', from: 'abc' });
    record('non-numeric-bounds-400', garbage.status === 400);

    // 10: performance budget.
    const rand = lcg(777);
    const queries = [];
    for (let i = 0; i < PERF_QUERIES; i++) {
      const type = TYPES[Math.floor(rand() * TYPES.length)];
      const start = EPOCH_MS + Math.floor(rand() * SPAN_MS * 0.7);
      queries.push({ type, from: start, to: start + Math.floor(rand() * SPAN_MS * 0.5) });
    }
    const started = Date.now();
    for (let i = 0; i < queries.length; i += 20) {
      await Promise.all(queries.slice(i, i + 20).map(q => query(port, q)));
    }
    const elapsed = Date.now() - started;
    console.log(`perf: ${elapsed}ms for ${PERF_QUERIES} queries (threshold ${PERF_THRESHOLD_MS}ms)`);
    record('performance-budget', elapsed < PERF_THRESHOLD_MS);

    app.close();
  } catch { /* grader-side failure leaves remaining checks unscored */ }

  // 11: no external dependencies.
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const sources = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const item = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(item);
        else if (entry.name.endsWith('.js')) sources.push(fs.readFileSync(item, 'utf8'));
      }
    };
    walk(path.join(root, 'src'));
    const bareImport = sources.some(source => /require\(\s*['"](?!node:)[a-z@][^'./]*['"]\s*\)/.test(source));
    record('no-external-dependencies', !bareImport && !pkg.dependencies && !pkg.devDependencies);
  } catch { record('no-external-dependencies', false); }

  finish();
})();
