'use strict';

/**
 * The one predicate every hook entry point uses to decide what its plugin root
 * is.
 *
 * Hook commands in hooks/hooks.json are launched as
 * `node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/<entry>.js" ...`. The harness
 * substitutes that token from its own knowledge of the install directory, and
 * separately exports CLAUDE_PLUGIN_ROOT into the hook process environment.
 * Those two paths agree in a normal Claude Code session but not everywhere:
 * a non-interpolating harness, a hand-written settings.json, or a user shell
 * that exports the variable as an empty string all reach an entry point whose
 * environment cannot be trusted.
 *
 * The entry point can always locate itself, so a `__dirname`-derived directory
 * is the dependable fallback. What the callers previously disagreed on was
 * when to prefer the environment:
 *
 *   run-with-flags.js         CLAUDE_PLUGIN_ROOT only, trimmed check
 *   posttooluse-dispatcher.js either variable, bare truthiness
 *   plugin-hook-bootstrap.js  either variable, bare truthiness
 *
 * A bare truthiness check accepts a whitespace-only variable, and every path
 * built from it resolves against the filesystem root instead of the plugin.
 * Honouring only CLAUDE_PLUGIN_ROOT silently drops the ECC_PLUGIN_ROOT escape
 * hatch that run-with-flags.js itself sets for the scripts it spawns.
 */

const CLAUDE_ROOT_VAR = 'CLAUDE_PLUGIN_ROOT';
const ECC_ROOT_VAR = 'ECC_PLUGIN_ROOT';

/**
 * A configured root counts only when it is a string with non-whitespace
 * content. Anything else means "not configured" and the caller's fallback
 * wins.
 *
 * @param {unknown} value
 * @returns {string|null} the trimmed root, or null when unusable
 */
function usableRoot(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve the plugin root for a hook entry point.
 *
 * @param {object} [options]
 * @param {Record<string, unknown>} [options.env]  Environment to read
 *   (defaults to process.env).
 * @param {string} options.fallback  Root to use when neither variable carries
 *   a usable value — callers pass a directory derived from their own location.
 * @returns {string} the resolved plugin root
 */
function resolvePluginRoot(options = {}) {
  const env = options.env || process.env;
  const fallback = options.fallback;

  return usableRoot(env[CLAUDE_ROOT_VAR]) || usableRoot(env[ECC_ROOT_VAR]) || fallback;
}

module.exports = { resolvePluginRoot, usableRoot, CLAUDE_ROOT_VAR, ECC_ROOT_VAR };
