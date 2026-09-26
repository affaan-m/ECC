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
//   node scripts/dev/generate-skill-triggers.js --provider claude \
//     [--model claude-sonnet-5] [--executable /path/to/claude] [--batch 40] [--dry-run]
//
// Codex requires an isolated executable and a dedicated subscription login
// home (the same lease rules as the outcome evaluator: never the user's own
// Codex home). Claude authenticates through CLAUDE_CODE_OAUTH_TOKEN,
// ANTHROPIC_API_KEY, or the macOS Keychain login, with an isolated
// CLAUDE_CONFIG_DIR per call. Provider calls: ceil(skills / batch).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadContextRegistry } = require('../lib/context-pack-registry');
const { createAuthLease, parseCodexJsonl, parseClaudeJson, providerFamily, readClaudeKeychainToken } = require('../../docker/context-profiles/ai-eval-lib');
const { digestObject, stableStringify } = require('../lib/context-profile-support');

const MANIFEST_PATH = 'manifests/context-packs/skill-triggers@1.json';
const MAX_TRIGGERS_PER_SKILL = 12;
const MAX_TRIGGER_CHARS = 80;
const DEFAULT_MODEL = { codex: 'gpt-5.6-sol', claude: 'claude-sonnet-5' };

function parseFlags(argv) {
  const flags = { batch: 25 };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') flags.dryRun = true;
    else if (['--auth-home', '--model', '--executable', '--batch', '--provider'].includes(arg)) {
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
  const executable = flags.executable || (flags.provider === 'claude' ? 'claude' : `${process.env.HOME}/.ecc-eval/codex/node_modules/.bin/codex`);
  const family = flags.provider || providerFamily(executable);
  const model = flags.model || DEFAULT_MODEL[family];
  if (flags.dryRun) {
    console.log(`would generate triggers for ${entries.length} skills via ${family} (${model}) in ${Math.ceil(entries.length / flags.batch)} provider calls`);
    return;
  }
  if (family === 'codex' && (!flags.authHome || !path.isAbsolute(flags.authHome))) throw new Error('--auth-home with an absolute dedicated login home is required for Codex');
  const lease = family === 'codex' ? createAuthLease(flags.authHome) : null;
  const claudeToken = () => process.env.CLAUDE_CODE_OAUTH_TOKEN || readClaudeKeychainToken();
  const triggers = {};
  const failed = [];
  const callProvider = batch => {
    const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-trigger-gen-'));
    try {
      if (family === 'codex') {
        let parsed = null;
        lease.run(home, () => {
          const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, LANG: 'C.UTF-8' };
          const result = require('node:child_process').spawnSync(executable,
            ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
              '--disable', 'apps', '--disable', 'remote_plugin', '-c', 'approval_policy="never"',
              '-c', 'model_reasoning_effort="low"', '--model', model, '-'],
            { input: promptFor(batch), cwd: home, env, encoding: 'utf8', shell: false,
              timeout: 240000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
          if (result.status !== 0) throw new Error(`provider exited ${result.status}`);
          parsed = extractJson(parseCodexJsonl(result.stdout).text);
        });
        return parsed;
      }
      const env = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: home, LANG: 'C.UTF-8',
        DISABLE_NON_ESSENTIAL_MODEL_CALLS: '1', CLAUDE_CODE_OAUTH_TOKEN: claudeToken() };
      const result = require('node:child_process').spawnSync(executable,
        ['--print', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--model', model],
        { input: promptFor(batch), cwd: home, env, encoding: 'utf8', shell: false,
          timeout: 240000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
      if (result.status !== 0) throw new Error(`provider exited ${result.status}`);
      return extractJson(parseClaudeJson(result.stdout).text);
    } finally { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }); }
  };
  // Model-generated JSON degrades at batch scale: retry each batch once, then halve until singles.
  const processBatch = batch => {
    try {
      const parsed = callProvider(batch);
      let ok = 0;
      for (const entry of batch) {
        const cleaned = cleanTriggers(parsed[entry.id], entry);
        if (cleaned.length) { triggers[entry.id] = cleaned; ok += 1; }
      }
      if (!ok) throw new Error('provider returned no usable triggers');
    } catch (error) {
      if (batch.length === 1) { failed.push(batch[0].id); console.error(`skill ${batch[0].id}: ${error.message}`); return; }
      const half = Math.ceil(batch.length / 2);
      processBatch(batch.slice(0, half));
      processBatch(batch.slice(half));
    }
  };
  for (let index = 0; index < entries.length; index += flags.batch) {
    processBatch(entries.slice(index, index + flags.batch));
    console.log(`progress: ${Object.keys(triggers).length}/${entries.length} skills have triggers`);
  }
  const manifest = { schemaVersion: 1, id: 'skill-triggers@1', registryDigest: registry.registryDigest,
    model: { id: model, ...(family === 'codex' ? { effort: 'low' } : {}),
      source: family === 'codex' ? 'codex-subscription-lease' : 'claude-subscription-login' },
    generatedAt: new Date().toISOString(),
    coverage: { skills: entries.length, withTriggers: Object.keys(triggers).length },
    triggers, triggersDigest: digestObject(triggers) };
  const target = path.join(repoRoot, MANIFEST_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${stableStringify(manifest)}\n`);
  console.log(`wrote ${MANIFEST_PATH}: ${manifest.coverage.withTriggers}/${manifest.coverage.skills} skills, ${Object.values(triggers).reduce((n, t) => n + t.length, 0)} triggers`);
  if (failed.length) { console.error(`skills with no usable triggers: ${failed.join(', ')}`); process.exitCode = 1; }
}

main();
