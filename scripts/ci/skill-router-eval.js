#!/usr/bin/env node
/**
 * Skill-router evaluation over a labelled prompt fixture.
 *
 * Usage:
 *   node scripts/ci/skill-router-eval.js [--fixture tests/fixtures/skill-router/prompts.json]
 *     [--profile lean@1] [--json] [--latency-samples 3]
 *     [--min-prompt-hit-rate 0.5] [--min-precision-at-3 0.5]
 *
 * Each fixture entry is { prompt, expected: [skillId, ...] }; expected IDs
 * are acceptable alternatives, so a prompt needs only one of them. Metrics:
 *
 *   promptHitRate        prompts with at least one expected skill among the
 *                        returned suggestions / all prompts.
 *   routedPromptHitRate  the same hits / prompts that returned any suggestion.
 *                        Prompt-level, NOT precision: one relevant suggestion
 *                        out of three counts as a full hit.
 *   precisionAt3         relevant suggestions / returned suggestions, counted
 *                        per suggestion across the (up to) three returned.
 *
 * Suggestions come from scripts/lib/skill-router.js, the same function the
 * hook's resolver child calls. The evaluator loads the canonical registry
 * once per root and passes it to every call through the resolver's
 * `registry` option, because reloading it for every prompt would only
 * re-measure hashing; each resolution still fails closed if a source changed
 * after it was loaded. Latency is therefore measured
 * separately, end to end through the real hook entrypoint, on
 * --latency-samples prompts.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');

const { loadContextRegistry } = require('../lib/context-pack-registry');
const { suggestSkills, DEFAULT_PROFILE_ID } = require('../lib/skill-router');

const registries = new Map();

/**
 * The canonical registry for `root`, loaded once per evaluator process.
 *
 * @param {string} root ECC root.
 * @returns {object} A loadContextRegistry() result.
 */
function registryFor(root) {
  const key = path.resolve(root);
  if (!registries.has(key)) {
    registries.set(key, loadContextRegistry({ repoRoot: key }));
  }
  return registries.get(key);
}

const HOOK_PATH = path.join(repoRoot, 'scripts', 'hooks', 'skill-router.js');

/**
 * Normalize a fixture skill reference to its canonical registry ID.
 *
 * @param {string} id Bare skill name or canonical `skill:` ID.
 * @returns {string} Canonical ID.
 */
function canonicalId(id) {
  return id.startsWith('skill:') ? id : `skill:${id}`;
}

/**
 * Round a ratio for reporting; an empty denominator reports 0.
 *
 * @param {number} numerator Numerator.
 * @param {number} denominator Denominator.
 * @returns {number} Ratio rounded to three places.
 */
function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(3));
}

/**
 * Whether a result meets the requested floors, compared on the raw counts:
 * the reported ratios are rounded to three places for display, and a value
 * just below a floor must not round up past it.
 *
 * @param {{prompts: number, promptHits: number, suggestionsReturned: number, relevantSuggestions: number}} result
 *   Counts from evaluatePrompts.
 * @param {{minPromptHitRate: number, minPrecisionAt3: number}} floors Requested floors.
 * @returns {boolean} True when both floors are met.
 */
function meetsFloors(result, { minPromptHitRate, minPrecisionAt3 }) {
  const hitRate = result.prompts === 0 ? 0 : result.promptHits / result.prompts;
  const precision = result.suggestionsReturned === 0 ? 0 : result.relevantSuggestions / result.suggestionsReturned;
  return hitRate >= minPromptHitRate && precision >= minPrecisionAt3;
}

/**
 * Nearest-rank percentile of a sample.
 *
 * @param {number[]} values Sample values (need not be pre-sorted).
 * @param {number} p Percentile as a fraction in [0, 1].
 * @returns {number} The value at that percentile, or 0 for an empty sample.
 */
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * Read and validate a fixture. Every expected ID must exist in the canonical
 * registry; an unknown ID could never be hit and would silently depress the
 * numbers.
 *
 * @param {string} fixturePath Absolute fixture path.
 * @param {string} root ECC root whose registry the IDs must exist in.
 * @returns {{prompts: Array<{prompt: string, expected: string[]}>}} Normalized fixture.
 */
function loadFixture(fixturePath, root = repoRoot) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const prompts = fixture.prompts || fixture;
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('fixture has no prompts');
  }
  const known = new Set(registryFor(root).entries.map(entry => entry.id));
  const normalized = prompts.map((entry, index) => {
    if (!entry || typeof entry.prompt !== 'string' || !Array.isArray(entry.expected) || entry.expected.length === 0) {
      throw new Error(`fixture prompt ${index} needs a prompt string and a non-empty expected array`);
    }
    const expected = entry.expected.map(canonicalId);
    const unknown = expected.filter(id => !known.has(id));
    if (unknown.length) {
      throw new Error(`fixture prompt ${index} expects unknown skill IDs: ${unknown.join(', ')}`);
    }
    return { prompt: entry.prompt, expected };
  });
  return { prompts: normalized };
}

/**
 * Score every fixture prompt against the router's suggestions.
 *
 * @param {Array<{prompt: string, expected: string[]}>} prompts Normalized prompts.
 * @param {object} [options] Options.
 * @param {string} [options.profileId] Context profile to resolve against.
 * @param {string} [options.root] ECC root.
 * @param {(prompt: string) => string[]} [options.suggest] Suggested IDs for a
 *   prompt; defaults to the router's own suggestSkills.
 * @returns {object} Counts, metrics, and misses.
 */
function evaluatePrompts(prompts, { profileId = DEFAULT_PROFILE_ID, root = repoRoot, suggest } = {}) {
  const suggestIds = suggest
    || (prompt => suggestSkills(prompt, { repoRoot: root, profileId, registry: registryFor(root) })
      .suggestions.map(s => s.id));
  let routedPrompts = 0;
  let promptHits = 0;
  let returned = 0;
  let relevant = 0;
  const misses = [];
  for (const entry of prompts) {
    const ids = suggestIds(entry.prompt);
    const relevantHere = ids.filter(id => entry.expected.includes(id)).length;
    returned += ids.length;
    relevant += relevantHere;
    if (ids.length > 0) routedPrompts += 1;
    if (relevantHere > 0) {
      promptHits += 1;
    } else {
      misses.push({ prompt: entry.prompt, expected: entry.expected, got: ids });
    }
  }
  return {
    prompts: prompts.length,
    routedPrompts,
    promptHits,
    suggestionsReturned: returned,
    relevantSuggestions: relevant,
    promptHitRate: ratio(promptHits, prompts.length),
    routedPromptHitRate: ratio(promptHits, routedPrompts),
    precisionAt3: ratio(relevant, returned),
    misses,
  };
}

/**
 * Time the real hook end to end (fresh process, live canonical resolution,
 * default budget) on the first `samples` prompts.
 *
 * @param {Array<{prompt: string}>} prompts Normalized prompts.
 * @param {number} samples How many prompts to time.
 * @param {string} profileId Context profile.
 * @returns {number[]} Wall-clock milliseconds per sample.
 */
function hookLatencyMs(prompts, samples, profileId) {
  return prompts.slice(0, samples).map(entry => {
    const startedAt = process.hrtime.bigint();
    spawnSync(process.execPath, [HOOK_PATH], {
      input: JSON.stringify({ prompt: entry.prompt }),
      encoding: 'utf8',
      env: { ...process.env, ECC_SKILL_ROUTER: '1', ECC_SKILL_ROUTER_PROFILE: profileId, CLAUDE_PLUGIN_ROOT: repoRoot },
      timeout: 60000,
    });
    return Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1));
  });
}

/**
 * Parse argv into options, exiting with a usage error on a malformed
 * numeric flag rather than silently coercing it to 0 or NaN (either of
 * which would make a gate never fail).
 *
 * @param {string[]} args CLI arguments.
 * @returns {object} Parsed options.
 */
function parseArgs(args) {
  const flag = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1];
  };
  const number = (name, fallback) => {
    const raw = flag(name, fallback);
    const value = Number(raw);
    if (typeof raw !== 'string' || raw.trim() === '' || !Number.isFinite(value) || value < 0) {
      console.error(`skill-router-eval: --${name} requires a non-negative number, got ${JSON.stringify(raw)}`);
      process.exit(1);
    }
    return value;
  };
  return {
    fixturePath: path.resolve(repoRoot, flag('fixture', 'tests/fixtures/skill-router/prompts.json')),
    profileId: flag('profile', DEFAULT_PROFILE_ID),
    asJson: args.includes('--json'),
    latencySamples: Math.floor(number('latency-samples', '3')),
    minPromptHitRate: number('min-prompt-hit-rate', '0'),
    minPrecisionAt3: number('min-precision-at-3', '0'),
  };
}

/**
 * Run the evaluation and set a non-zero exit code when a gate is missed.
 *
 * @returns {void}
 */
function main() {
  const options = parseArgs(process.argv.slice(2));
  let fixture;
  try {
    fixture = loadFixture(options.fixturePath);
  } catch (error) {
    console.error(`skill-router-eval: could not read fixture ${options.fixturePath}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const result = evaluatePrompts(fixture.prompts, { profileId: options.profileId });
  const latency = hookLatencyMs(fixture.prompts, options.latencySamples, options.profileId);
  const report = {
    fixture: path.relative(repoRoot, options.fixturePath).split(path.sep).join('/'),
    profileId: options.profileId,
    ...result,
    hookLatencyMs: { samples: latency, p50: percentile(latency, 0.5), max: latency.length ? Math.max(...latency) : 0 },
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
  };

  if (options.asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Skill router eval - ${report.prompts} prompts from ${report.fixture} (${report.profileId})`);
    console.log(`  prompt hit rate: ${report.promptHitRate} (${report.promptHits}/${report.prompts} prompts)`);
    console.log(`  routed-prompt hit rate: ${report.routedPromptHitRate} (${report.promptHits}/${report.routedPrompts} prompts with any suggestion)`);
    console.log(`  precision@3: ${report.precisionAt3} (${report.relevantSuggestions}/${report.suggestionsReturned} returned suggestions relevant)`);
    if (latency.length) {
      console.log(`  hook latency, end to end: ${latency.join(', ')}ms (p50 ${report.hookLatencyMs.p50}ms)`);
    }
    for (const miss of report.misses) {
      console.log(`  miss: "${miss.prompt}" expected ${miss.expected.join('|')} got ${miss.got.join(', ') || '(none)'}`);
    }
  }

  if (!meetsFloors(report, options)) {
    console.error(`skill-router-eval: below threshold (prompt hit rate ${report.promptHitRate} < ${options.minPromptHitRate} or precision@3 ${report.precisionAt3} < ${options.minPrecisionAt3})`);
    process.exitCode = 1;
  }
}

module.exports = { canonicalId, evaluatePrompts, loadFixture, meetsFloors, ratio };

if (require.main === module) {
  main();
}
