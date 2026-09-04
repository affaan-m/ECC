#!/usr/bin/env node
/**
 * SessionStart hook: build the skill-router catalog cache.
 *
 * The router's prompt-submit path reads a cache and never builds one, so the
 * build has to happen somewhere that is not on a blocking hot path. There
 * are two such places:
 *
 *   - carrier generation, which knows the catalog it just shipped and embeds
 *     it in the receipt; and
 *   - this hook, for a non-carrier install, once per session.
 *
 * It is gated by the same opt-in env var as the router itself, so enabling
 * nothing changes nothing. It exits 0 unconditionally: a session must never
 * fail to start because a suggestion cache could not be written.
 *
 * The in-scan deadline is kept as defence in depth. It is far less critical
 * here than on the prompt path — a slow SessionStart delays one session
 * start, not every turn — but an unbounded directory walk is still worth a
 * bound.
 */

'use strict';

const path = require('path');

const { buildCatalogCache } = require('../lib/skill-router');

const BUILD_BUDGET_MS = 2000;

function isEnabled(env = process.env) {
  const raw = String(env.ECC_SKILL_ROUTER || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

/**
 * Build the cache for this session's plugin root.
 *
 * @param {string} [rawInput] Hook stdin (unused; accepted for the run-with-flags contract).
 * @param {object} [context] Optional overrides for tests.
 * @returns {{exitCode: number, stdout: string, stderr?: string}} Hook result.
 */
function run(rawInput, context = {}) {
  const env = context.env || process.env;
  if (!isEnabled(env)) {
    return { exitCode: 0, stdout: '' };
  }

  const pluginRoot = context.pluginRoot
    || env.CLAUDE_PLUGIN_ROOT
    || path.resolve(__dirname, '..', '..');

  try {
    const result = buildCatalogCache(pluginRoot, { deadlineAt: Date.now() + BUILD_BUDGET_MS });
    if (!result.complete) {
      return {
        exitCode: 0,
        stdout: '',
        stderr: `[SkillRouter] catalog scan hit the ${BUILD_BUDGET_MS}ms build budget; cache not written`,
      };
    }
    return { exitCode: 0, stdout: '' };
  } catch (error) {
    return { exitCode: 0, stdout: '', stderr: `[SkillRouter] cache build failed: ${error.message}` };
  }
}

if (require.main === module) {
  const result = run('');
  if (result.stderr) {
    process.stderr.write(`${result.stderr}\n`);
  }
  process.exit(0);
}

module.exports = { run, isEnabled, BUILD_BUDGET_MS };
