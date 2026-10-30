'use strict';
// Calibration harness (not shipped in the corpus): measures the 2,000-query
// workload wall time for the shipped naive app and the reference app, each
// staged as a standalone copy (fixture; fixture + reference overlay).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = __dirname;
const fixture = path.join(root, 'cases2', 'event-stats-api', 'files');
const overlay = path.join(root, 'reference2', 'event-stats-api');

function stage(withOverlay) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-calib-'));
  const copy = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copy(path.join(from, entry.name), target); }
      else fs.copyFileSync(path.join(from, entry.name), target);
    }
  };
  copy(fixture, dir);
  if (withOverlay) copy(overlay, dir);
  return dir;
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function workload(types, epoch, span) {
  const rand = lcg(777);
  const queries = [];
  for (let i = 0; i < 2000; i++) {
    const type = types[Math.floor(rand() * types.length)];
    const start = epoch + Math.floor(rand() * span * 0.7);
    queries.push({ type, from: start, to: start + Math.floor(rand() * span * 0.5) });
  }
  return queries;
}

async function measure(label, dir) {
  const { createApp } = require(path.join(dir, 'src', 'app.js'));
  const { TYPES, EPOCH_MS, SPAN_MS } = require(path.join(dir, 'src', 'data.js'));
  const app = createApp();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const port = app.address().port;
  const queries = workload(TYPES, EPOCH_MS, SPAN_MS);
  const started = Date.now();
  for (let i = 0; i < queries.length; i += 20) {
    await Promise.all(queries.slice(i, i + 20).map(q =>
      fetch(`http://127.0.0.1:${port}/stats?type=${q.type}&from=${q.from}&to=${q.to}`).then(r => r.json())));
  }
  const elapsed = Date.now() - started;
  app.close();
  console.log(`${label}: ${elapsed}ms for 2000 queries`);
  return elapsed;
}

(async () => {
  const naiveDir = stage(false);
  const refDir = stage(true);
  await measure('naive 1     ', naiveDir);
  await measure('naive 2     ', naiveDir);
  await measure('reference 1 ', refDir);
  await measure('reference 2 ', refDir);
  fs.rmSync(naiveDir, { recursive: true, force: true });
  fs.rmSync(refDir, { recursive: true, force: true });
})();
