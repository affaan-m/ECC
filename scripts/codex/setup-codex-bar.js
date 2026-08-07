#!/usr/bin/env node
/**
 * setup-codex-bar — install/remove the `codex` shell alias for the ECC usage bar.
 *
 * Usage:
 *   node scripts/codex/setup-codex-bar.js            # install (default)
 *   node scripts/codex/setup-codex-bar.js remove     # remove the alias block
 *   node scripts/codex/setup-codex-bar.js status     # show current state
 *
 * Installing writes a managed block to ~/.zshrc and/or ~/.bashrc so plain
 * `codex [args...]` runs through scripts/codex/ecc-codex. Runtime opt-outs:
 * ECC_CODEX_ALIAS=off (skip the alias) or ECC_CODEX_BAR=off (alias without bar).
 */

'use strict';

const {
  ensureCodexAliasDefault,
  removeCodexAlias,
  aliasStatus,
} = require('../lib/codex-shell-alias');
const {
  ensureCodexStatusLineDefault,
  statusLineStatus,
} = require('../lib/codex-status-line');

function main() {
  const action = process.argv[2] || 'install';

  if (action === 'status') {
    const status = aliasStatus();
    for (const file of status.files) {
      const state = file.installed ? 'installed' : file.exists ? 'not installed' : 'file absent';
      console.log(`  ${file.path}: ${state}`);
    }
    console.log(status.installed
      ? '\n`codex` runs through the ECC usage bar in new shells.'
      : '\nECC codex alias is not installed.');
    const tui = statusLineStatus();
    console.log(tui.installed
      ? 'Codex TUI status_line: configured.'
      : 'Codex TUI status_line: not configured.');
    return;
  }

  if (action === 'remove') {
    const result = removeCodexAlias();
    if (result.action === 'removed') {
      for (const file of result.files) console.log(`  removed from ${file.path}`);
      console.log('\nDone. Open a new shell (or `unalias codex`) to pick this up.');
    } else if (result.action === 'not-installed') {
      console.log('ECC codex alias was not installed — nothing to do.');
    } else {
      console.error(`Could not remove the alias: ${result.error || result.reason}`);
      process.exitCode = 1;
    }
    return;
  }

  if (action !== 'install') {
    console.error(`Unknown action "${action}". Use: install | remove | status`);
    process.exitCode = 1;
    return;
  }

  const tui = ensureCodexStatusLineDefault();
  console.log(`  ${tui.action}: codex TUI status_line${tui.configPath ? ` (${tui.configPath})` : ''}`);

  const result = ensureCodexAliasDefault();
  if (result.action === 'configured' || result.action === 'kept-existing') {
    for (const file of result.files) console.log(`  ${file.action}: ${file.path}`);
    if (result.action === 'configured') {
      console.log('\n`codex` now runs with the ECC usage bar in new shells.');
      console.log('Opt out any time: export ECC_CODEX_ALIAS=off, or rerun with `remove`.');
    } else {
      console.log('\nYou already have your own codex alias — ECC will not override it.');
      console.log('To route it through the ECC bar, point it at the wrapper (your flags pass through):');
      console.log(`  alias codex='bash "${result.wrapperPath}" <your-flags>'`);
    }
  } else {
    console.error(`Skipped: ${result.error || result.reason}`);
    process.exitCode = 1;
  }
}

main();
