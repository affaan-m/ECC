#!/usr/bin/env node
'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_IDS = Object.freeze(['lean@1', 'full@1']);
const COMMANDS = Object.freeze(['show', 'preview', 'explain']);
const VALUES = Object.freeze(['--target', '--selection', '--include', '--exclude']);

function helpText() {
  return `ECC context profiles (read-only preview)

Usage:
  ecc profile show [lean@1|full@1] [--json]
  ecc profile preview [lean@1|full@1] [--target codex] [--selection auto|manual|suggest]
      [--include skill:<id>] [--exclude skill:<id>] [--json]
  ecc profile explain skill:<id> [--target codex] [--json]

Include/exclude flags may be repeated. Preview defaults: lean@1, codex, auto.
These defaults describe a proposal, not your installed configuration.
No command installs, activates, invokes skills, enables hooks, or grants authority.
Token estimates cover skill metadata only; actual host context remains unobserved.
The existing install --profile and hook profile flags keep their own meanings.
`;
}

function parseArgs(argv) {
  const parsed = { command: null, id: null, target: 'codex', selectionMode: 'auto',
    include: [], exclude: [], json: false, help: false };
  const seen = new Set();
  const args = argv.filter(arg => arg !== '--dry-run');
  if (!args.length) return { ...parsed, help: true };
  if (!args[0].startsWith('-')) parsed.command = args.shift();
  if (parsed.command && !COMMANDS.includes(parsed.command)) {
    throw new Error(`Unknown read-only profile command: ${parsed.command}`);
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--help', '-h'].includes(arg)) parsed.help = true;
    else if (arg === '--json') parsed.json = true;
    else if (VALUES.includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${arg}`);
      if (seen.has(arg) && !['--include', '--exclude'].includes(arg)) {
        throw new Error(`Duplicate argument: ${arg}`);
      }
      seen.add(arg);
      if (arg === '--include') parsed.include.push(value);
      if (arg === '--exclude') parsed.exclude.push(value);
      if (arg === '--target') parsed.target = value;
      if (arg === '--selection') parsed.selectionMode = value;
    } else if (!arg.startsWith('-') && !parsed.id) parsed.id = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.help) return parsed;
  if (!parsed.command) throw new Error('Choose show, preview, or explain');
  const allowed = parsed.command === 'preview' ? VALUES
    : parsed.command === 'explain' ? ['--target'] : [];
  for (const flag of seen) {
    if (!allowed.includes(flag)) throw new Error(`${flag} is unavailable for ${parsed.command}`);
  }
  if (parsed.command === 'explain' && !parsed.id) throw new Error('Missing skill ID for explain');
  return parsed;
}

function envelope(status, summary, values = {}) {
  return { schemaVersion: 'ecc.profile-inspection.v1', status, summary,
    activation: 'unobserved', next_actions: [], artifacts: [], ...values };
}

function buildResponse(options, repoRoot = ROOT) {
  const { loadContextProfile, compileContextProfile } = require('./lib/context-profiles');
  const { explainContextEntry } = require('./lib/context-pack-registry');
  if (options.command === 'show') {
    const values = options.id
      ? { profile: loadContextProfile(options.id, { repoRoot }) }
      : { profiles: PROFILE_IDS.map(id => loadContextProfile(id, { repoRoot })) };
    return envelope('success', 'Context profile definitions; installed state is unobserved.', values);
  }
  if (options.command === 'explain') {
    return envelope('success', 'Exact catalog entry; no skill has been loaded or invoked.', {
      entry: explainContextEntry({ repoRoot, id: options.id, target: options.target }),
    });
  }
  const plan = compileContextProfile({ repoRoot, profileId: options.id || 'lean@1',
    target: options.target, selectionMode: options.selectionMode,
    include: options.include, exclude: options.exclude });
  return envelope('warning', 'Proposed skill-discovery projection; runtime activation and whole-context cost are unobserved.', {
    plan, artifacts: [{ kind: 'context-plan', digest: plan.planDigest }],
    next_actions: ['Review selected IDs, exclusions, and target declarations before adapter integration.'],
  });
}

function formatText(response) {
  const lines = [response.summary, `Activation: ${response.activation}`];
  if (response.profiles) lines.push(...response.profiles.map(profile => `${profile.id}: ${profile.description}`));
  if (response.profile) lines.push(JSON.stringify(response.profile, null, 2));
  if (response.entry) {
    const entry = response.entry;
    lines.push(`${entry.id}: ${entry.description}`, `Source: ${entry.sourcePath}`,
      `Install support: ${entry.projection.installSupport}; native support: ${entry.projection.nativeSupport}`);
  }
  if (response.plan) {
    const plan = response.plan;
    lines.push(`Profile: ${plan.profileId}; selection: ${plan.selectionMode}; target: ${plan.target}`,
      `Selected: ${plan.selectedIds.join(', ') || '(none)'}`,
      `Routed: ${plan.routedIds.length}; excluded: ${plan.excludedIds.length}`,
      `Metadata estimate: ${plan.estimate.estimatedTokens} tokens (${plan.estimate.method}).`,
      'Whole ECC startup budget: unobserved; this estimate does not certify a native host.',
      `Plan digest: ${plan.planDigest}`, ...plan.limitations);
  }
  lines.push(...response.next_actions.map(action => `Next: ${action}`));
  const text = `${lines.join('\n')}\n`;
  return [...text].map(character => {
    const code = character.codePointAt(0);
    return ((code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159))
      ? `\\u${code.toString(16).padStart(4, '0')}` : character;
  }).join('');
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) { process.stdout.write(helpText()); return 0; }
    const response = buildResponse(options);
    process.stdout.write(options.json ? `${JSON.stringify(response, null, 2)}\n` : formatText(response));
    return 0;
  } catch (error) {
    const response = envelope('error', error.message, {
      next_actions: ['Run ecc profile --help and correct the request or source contract. No activation was attempted.'],
    });
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    else process.stderr.write(formatText(response));
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { buildResponse, formatText, helpText, main, parseArgs };
