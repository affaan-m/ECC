#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { configRoot } = require('./lib/copilot-sessions');
const { resolveCheckout } = require('./lib/copilot-runtime-root');
const { findPotentialSecrets, hasUnsafeControlCharacters } = require('./lib/memory-vault-format');

const ACTIONS = Object.freeze(['claim', 'decompose', 'publish', 'review', 'sync', 'unblock', 'validate']);
const COLLECTIONS = Object.freeze(['sync', 'unblock']);
const VALUE_FLAGS = Object.freeze(['--repo', '--issue', '--actor', '--branch', '--review', '--limit', '--approve']);
const MAX_OUTPUT_BYTES = 1024 * 1024;

function parseArgs(args) {
  const [action, ...rest] = args;
  if (!ACTIONS.includes(action)) throw new Error('Choose a supported epic action.');
  let options = { action, apply: false, limit: 100 };
  const seen = new Set();
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (seen.has(flag)) throw new Error('Duplicate epic option.');
    seen.add(flag);
    if (flag === '--apply') options = { ...options, apply: true };
    else {
      if (!VALUE_FLAGS.includes(flag) || !rest[index + 1] || rest[index + 1].startsWith('--')) throw new Error('Invalid epic option.');
      options = { ...options, [flag.slice(2)]: rest[++index] };
    }
  }
  if (typeof options.repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(options.repo)) throw new Error('Explicit owner/repository is required.');
  if (options.repo.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid repository.');
  if (!COLLECTIONS.includes(action) && !/^[1-9]\d{0,9}$/.test(options.issue || '')) throw new Error('Explicit positive issue number is required.');
  if (COLLECTIONS.includes(action) && options.issue !== undefined) throw new Error('Collection actions require repository scope.');
  if (!/^\d+$/.test(String(options.limit)) || Number(options.limit) < 1 || Number(options.limit) > 1000) throw new Error('Issue scan limit must be between 1 and 1000.');
  if (options.actor !== undefined && !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(options.actor)) throw new Error('Invalid actor.');
  if (options.branch !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(options.branch) || options.branch.includes('..'))) throw new Error('Invalid branch.');
  if (options.review !== undefined && !['requested', 'approved', 'changes-requested', 'not-requested'].includes(options.review)) throw new Error('Invalid review state.');
  if (action === 'review' && !options.review) options = { ...options, review: 'requested' };
  const scope = `${action}:${options.repo}#${COLLECTIONS.includes(action) ? 'all' : options.issue}`;
  if (options.apply && options.approve !== scope) throw new Error('Apply requires exact action/repository/issue approval scope.');
  if (!options.apply && options.approve !== undefined) throw new Error('Approval scope requires --apply.');
  return { ...options, scope };
}

function childEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLAUDE_')));
}

function runChild(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', timeout: 120000, maxBuffer: MAX_OUTPUT_BYTES, shell: false });
  if (result.error || result.status !== 0) throw new Error('Epic backend failed or timed out; inspect authenticated GitHub access, pinned runtime dependencies and coordination policy.');
  if (findPotentialSecrets(result.stdout || '').length || hasUnsafeControlCharacters(result.stdout || '', true)) throw new Error('Epic backend output rejected suspected secrets or unsafe controls.');
  return result.stdout;
}

function authenticatedActor(env, cwd) {
  // ECC_GH_SHIM is the canonical backend's operator-controlled test seam. It is
  // not derived from issue content, command arguments or project configuration.
  const command = env.ECC_GH_SHIM ? process.execPath : 'gh';
  const args = [...(env.ECC_GH_SHIM ? [env.ECC_GH_SHIM] : []), 'api', 'user', '--jq', '.login'];
  const actor = runChild(command, args, { cwd, env }).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(actor)) throw new Error('Unable to verify authenticated GitHub identity.');
  return actor;
}

function privateCache(workspace, env) {
  const root = configRoot(env);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  let current = fs.realpathSync(root);
  for (const part of ['ecc', 'projects', crypto.createHash('sha256').update(workspace).digest('hex')]) {
    current = path.join(current, part);
    try { fs.mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe Copilot coordination directory.');
  }
  return current;
}

function backendArgs(options, db, home) {
  return [options.action, ...(options.issue ? [options.issue] : []), '--repo', options.repo, '--db', db,
    '--home', home, '--limit', String(options.limit), '--json',
    ...(!options.apply ? ['--dry-run'] : []),
    ...(options.actor ? ['--actor', options.actor] : []),
    ...(options.branch ? ['--branch', options.branch] : []),
    ...(options.review ? ['--review', options.review] : [])];
}

function run(args, options = {}) {
  const request = parseArgs(args);
  const env = childEnvironment(options.env || process.env);
  const cwd = fs.realpathSync(options.cwd || process.cwd());
  const checkout = resolveCheckout(env);
  const entry = path.join(checkout, 'scripts/github-coordination.js');
  if (!fs.statSync(entry).isFile()) throw new Error('Pinned ECC coordination backend is missing.');
  const actor = request.apply ? authenticatedActor(env, cwd) : null;
  if (request.action === 'claim' && request.actor && actor && request.actor.toLowerCase() !== actor.toLowerCase()) throw new Error('Claim actor must match authenticated GitHub identity.');
  const effective = request.action === 'claim' && actor ? { ...request, actor } : request;
  const cache = request.apply ? privateCache(cwd, env) : null;
  const lock = cache && path.join(cache, 'coordination-action.lock');
  if (lock) fs.mkdirSync(lock, { mode: 0o700 });
  try {
    const db = cache ? path.join(cache, 'coordination.db') : ':memory:';
    if (cache) for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        const stat = fs.lstatSync(db + suffix);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe coordination database file.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const output = runChild(process.execPath, [entry, ...backendArgs(effective, db, configRoot(env))], { cwd, env });
    const result = JSON.parse(output);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid coordination result.');
    return { action: request.action, repo: request.repo, mode: request.apply ? 'apply' : 'preview',
      approvalScope: request.scope, trust: 'untrusted-github-data', result };
  } finally { if (lock) fs.rmdirSync(lock); }
}

function main() {
  try { process.stdout.write(`${JSON.stringify(run(process.argv.slice(2)))}\n`); }
  catch (error) {
    // Do not echo issue bodies, generated comments, tokens or upstream argv.
    const reason = error instanceof SyntaxError ? 'Invalid epic backend JSON.' : (error.code ? 'Epic runtime or private cache unavailable.' : error.message);
    process.stderr.write(`${reason}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ACTIONS, parseArgs, run, backendArgs, authenticatedActor, privateCache };
if (require.main === module) main();
