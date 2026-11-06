'use strict';

// Denial text is tool output the guarded agent reads. Naming the env vars that
// disable a hook hands it a bypass, so recovery instructions are opt-in for
// human operators (#3844). Every hook must parse the switch the same way.
const ENABLE_VALUES = new Set(['1', 'true', 'on', 'enabled', 'enable', 'yes']);

function showRecoveryHints(value = process.env.ECC_SHOW_RECOVERY_HINTS) {
  return ENABLE_VALUES.has(String(value || '').trim().toLowerCase());
}

module.exports = { showRecoveryHints };
