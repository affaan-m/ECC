'use strict';

function isDryRun(options = {}, env = process.env) {
  const dryRunEnv = env.ECC_DRY_RUN;
  if (dryRunEnv !== undefined && dryRunEnv !== '0' && dryRunEnv !== '1') {
    throw new Error('ECC_DRY_RUN must be "1" or "0" when set');
  }
  return Boolean(options.dryRun) || dryRunEnv === '1';
}

module.exports = {
  isDryRun,
};
