'use strict';

/**
 * Dry-run is enabled either by a subcommand-level `--dry-run` flag or by the
 * global `ecc --dry-run <command>` prefix, which sets ECC_DRY_RUN=1 (#2952).
 * Every subcommand must honor both forms rather than silently ignoring the
 * global flag.
 */
function resolveDryRun(flagValue, env = process.env) {
  const dryRunEnv = env.ECC_DRY_RUN;
  if (dryRunEnv !== undefined && dryRunEnv !== '0' && dryRunEnv !== '1') {
    throw new Error('ECC_DRY_RUN must be "1" or "0" when set');
  }
  return Boolean(flagValue) || dryRunEnv === '1';
}

module.exports = { resolveDryRun };
