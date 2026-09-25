#!/usr/bin/env node
'use strict';

// Dev-time generator for manifests/context-packs/skill-triggers@1.json.
//
// For every canonical skill, asks the pinned provider for short trigger
// phrasings a user would type when that skill applies (synonyms, task
// wordings, related technology names), grounded STRICTLY in the skill's own
// description. The manifest is checked in, digest-stable, and read by the
// retrieval index at runtime, so runtime behavior stays deterministic and
// offline. Rerun this script after adding or re-describing skills.
//
// Usage:
//   node scripts/dev/generate-skill-triggers.js --auth-home ~/.ecc-eval/auth \
//     [--model gpt-5.6-sol] [--executable /path/to/codex] [--batch 25] [--dry-run]
//
// Requires an isolated Codex executable and a dedicated subscription login
// home (the same lease rules as the outcome evaluator: never the user's own
// Codex home). Provider calls: ceil(skills / batch).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadContextRegistry } = require('../lib/context-pack-registry');
const { createAuthLease, parseCodexJsonl } = require('../../docker/context-profiles/ai-eval-lib');
const { digestObject, stableStringify } = require('../lib/context-profile-support');

const MANIFEST_PATH = 'manifests/context-packs/skill-triggers@1.json';
const MAX_TRIGGERS_PER_SKILL = 12;
const MAX_TRIGGER_CHARS = 80;

function parseFlags(argv) {
  const flags = { batch: 25, model: 'gpt-5.6-sol' };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--auth-home' || arg === '--model' || arg === '--executable' || arg === '--batch') {
      flags[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[index += 1];
    } else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function promptFor(batch) {
  const lines = batch.map(entry => ({ id: entry.id, name: entry.name, description: entry.description }));
  return `You generate retrieval triggers for a skills library. For EACH skill below, output a JSON object mapping its id to an array of ${MAX_TRIGGERS_PER_SKILL} short trigger phrases (each under ${MAX_TRIGGER_CHARS} characters): realistic task wordings, synonyms, and related technology names a developer would type when this skill applies. Ground every trigger ONLY in the skill description; never invent capabilities the description does not claim. Prefer concrete task phrasings over category words. Output ONE JSON object and nothing else.\n\n${JSON.stringify(lines, null, 1)}`;
}

function extractJson(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Provider returned no JSON object');
  return JSON.parse(trimmed.slice(start, end + 1));
}

function cleanTriggers(value, entry) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map(item => String(item).trim().toLowerCase()).filter(item => {
    if (!item || item.length > MAX_TRIGGER_CHARS || seen.has(item)) return false;
    if (!/^[a-z0-9][a-z0-9 +/#.:-]*$/.test(item)) return false;
    seen.add(item);
    return true;
  }).slice(0, MAX_TRIGGERS_PER_SKILL);
}

function main() {
  const flags = parseFlags(process.argv);
  const repoRoot = path.join(__dirname, '..', '..');
  const registry = loadContextRegistry({ repoRoot });
  const entries = registry.entries.filter(entry => entry.id.startsWith('skill:'));
  if (flags.dryRun) {
    console.log(`would generate triggers for ${entries.length} skills in ${Math.ceil(entries.length / flags.batch)} provider calls`);
    return;
  }
  if (!flags.authHome || !path.isAbsolute(flags.authHome)) throw new Error('--auth-home with an absolute dedicated login home is required');
  const executable = flags.executable || `${process.env.HOME}/.ecc-eval/codex/node_modules/.bin/codex`;
  const lease = createAuthLease(flags.authHome);
  const triggers = {};
  const failed = [];
  const batches = Math.ceil(entries.length / flags.batch);
  for (let index = 0; index < entries.length; index += flags.batch) {
    const batch = entries.slice(index, index + flags.batch);
    const number = Math.floor(index / flags.batch) + 1;
    const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-trigger-gen-'));
    let parsed = null;
    try {
      lease.run(home, () => {
        const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, LANG: 'C.UTF-8' };
        const result = require('node:child_process').spawnSync(executable,
          ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
            '--disable', 'apps', '--disable', 'remote_plugin', '-c', 'approval_policy="never"',
            '-c', 'model_reasoning_effort="low"', '--model', flags.model, '-'],
          { input: promptFor(batch), cwd: home, env, encoding: 'utf8', shell: false,
            timeout: 240000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
        if (result.status !== 0) throw new Error(`provider exited ${result.status}: ${(result.stderr || '').slice(0, 200)}`);
        parsed = extractJson(parseCodexJsonl(result.stdout).text);
      });
    } finally { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }); }
    let ok = 0;
    for (const entry of batch) {
      const cleaned = cleanTriggers(parsed[entry.id], entry);
      if (cleaned.length) { triggers[entry.id] = cleaned; ok += 1; }
    }
    console.log(`batch ${number}/${batches}: ${ok}/${batch.length} skills received triggers`);
    if (!ok) failed.push(number);
  }
  const manifest = { schemaVersion: 1, id: 'skill-triggers@1', registryDigest: registry.registryDigest,
    model: { id: flags.model, effort: 'low', source: 'codex-subscription-lease' },
    generatedAt: new Date().toISOString(),
    coverage: { skills: entries.length, withTriggers: Object.keys(triggers).length },
    triggers, triggersDigest: digestObject(triggers) };
  const target = path.join(repoRoot, MANIFEST_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${stableStringify(manifest)}\n`);
  console.log(`wrote ${MANIFEST_PATH}: ${manifest.coverage.withTriggers}/${manifest.coverage.skills} skills, ${Object.values(triggers).reduce((n, t) => n + t.length, 0)} triggers`);
  if (failed.length) { console.error(`batches with zero parsed output: ${failed.join(', ')}`); process.exitCode = 1; }
}

main();
