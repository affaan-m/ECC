#!/usr/bin/env node
/**
 * Skill-router evaluation: precision/recall at top-3 and latency.
 *
 * Usage:
 *   node scripts/ci/skill-router-eval.js [--fixture tests/fixtures/skill-router/prompts.json] [--json] [--min-precision 0.5] [--min-recall 0.5]
 *
 * Each fixture entry is { prompt, expected: [skillId, ...] }. A prompt counts
 * as a hit when at least one expected skill appears in the routed top-3.
 * Precision@3 is hits over prompts that produced any routing; recall@3 is
 * hits over all prompts. Latency is measured cold (fresh process, empty
 * cache) and warm (in-process repeat).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const fixturePath = path.resolve(repoRoot, flag('fixture', 'tests/fixtures/skill-router/prompts.json'));
const asJson = args.includes('--json');
const minPrecision = Number(flag('min-precision', '0'));
const minRecall = Number(flag('min-recall', '0'));

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-router-eval-cache-'));
process.env.ECC_SKILL_ROUTER_CACHE_DIR = cacheDir;

const { routePrompt } = require('../lib/skill-router');

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function coldLatencyMs() {
  // Fresh process + empty cache: the first prompt pays the full catalog scan.
  const coldCache = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-router-eval-cold-'));
  const script = `const t=Date.now();require(${JSON.stringify(path.join(repoRoot, 'scripts', 'lib', 'skill-router.js'))}).routePrompt('apply react patterns when refactoring this component',{pluginRoot:${JSON.stringify(repoRoot)}});process.stdout.write(String(Date.now()-t));`;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ECC_SKILL_ROUTER_CACHE_DIR: coldCache },
  });
  fs.rmSync(coldCache, { recursive: true, force: true });
  return Number(result.stdout) || 0;
}

function main() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const prompts = fixture.prompts || fixture;
  const misses = [];
  const warmLatencies = [];
  let routed = 0;
  let hits = 0;

  // Prime the cache once so warm numbers are warm.
  routePrompt('warm up the catalog cache please', { pluginRoot: repoRoot });

  for (const entry of prompts) {
    const startedAt = process.hrtime.bigint();
    const matches = routePrompt(entry.prompt, { pluginRoot: repoRoot });
    warmLatencies.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
    const ids = matches.map(m => m.id);
    if (ids.length > 0) routed += 1;
    if (entry.expected.some(id => ids.includes(id))) {
      hits += 1;
    } else {
      misses.push({ prompt: entry.prompt, expected: entry.expected, got: ids });
    }
  }

  const coldRuns = [coldLatencyMs(), coldLatencyMs(), coldLatencyMs()];
  const report = {
    fixture: path.relative(repoRoot, fixturePath).split(path.sep).join('/'),
    prompts: prompts.length,
    routed,
    hits,
    precisionAt3: routed === 0 ? 0 : Number((hits / routed).toFixed(3)),
    recallAt3: prompts.length === 0 ? 0 : Number((hits / prompts.length).toFixed(3)),
    latencyMs: {
      warmP50: Number(percentile(warmLatencies, 0.5).toFixed(2)),
      warmP95: Number(percentile(warmLatencies, 0.95).toFixed(2)),
      coldRuns,
      coldMax: Math.max(...coldRuns),
    },
    misses,
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
  };

  fs.rmSync(cacheDir, { recursive: true, force: true });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Skill router eval - ${report.prompts} prompts from ${report.fixture}`);
    console.log(`  precision@3: ${report.precisionAt3}  recall@3: ${report.recallAt3}  (hits ${hits}, routed ${routed})`);
    console.log(`  latency warm p50/p95: ${report.latencyMs.warmP50}ms / ${report.latencyMs.warmP95}ms; cold (3 runs): ${coldRuns.join(', ')}ms`);
    for (const miss of misses) {
      console.log(`  miss: "${miss.prompt}" expected ${miss.expected.join('|')} got ${miss.got.join(', ') || '(none)'}`);
    }
  }

  if (report.precisionAt3 < minPrecision || report.recallAt3 < minRecall) {
    console.error(`skill-router-eval: below threshold (precision ${report.precisionAt3} < ${minPrecision} or recall ${report.recallAt3} < ${minRecall})`);
    process.exitCode = 1;
  }
}

main();
