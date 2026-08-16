#!/usr/bin/env node
'use strict';

const {
  beginLegacySyncState,
  finalizeLegacySyncState,
  recordLegacySyncPath,
  rollbackLegacyCodexSync,
} = require('../lib/codex-legacy-sync');

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (command === 'begin') {
    const codexHome = readFlag(argv, '--codex-home');
    const backupDir = readFlag(argv, '--backup-dir');
    if (!codexHome || !backupDir) throw new Error('begin requires --codex-home and --backup-dir');
    process.stdout.write(`${beginLegacySyncState({
      codexHome,
      backupDir,
      previousHooksPath: readFlag(argv, '--previous-hooks-path') || '',
      installedHooksPath: readFlag(argv, '--installed-hooks-path'),
    })}\n`);
    return;
  }
  if (command === 'record') {
    const statePath = readFlag(argv, '--state');
    const filePath = readFlag(argv, '--path');
    if (!statePath || !filePath) throw new Error('record requires --state and --path');
    recordLegacySyncPath({ statePath, filePath });
    return;
  }
  if (command === 'finalize') {
    const statePath = readFlag(argv, '--state');
    if (!statePath) throw new Error('finalize requires --state');
    finalizeLegacySyncState({ statePath });
    return;
  }
  if (command === 'rollback') {
    const statePath = readFlag(argv, '--state');
    if (!statePath) throw new Error('rollback requires --state');
    const result = rollbackLegacyCodexSync({ statePath });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'rolled-back') process.exitCode = 1;
    return;
  }
  throw new Error('Usage: legacy-sync-state.js <begin|record|finalize|rollback> [options]');
}

module.exports = { main, readFlag };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[ecc-sync] ERROR: ${error.message}\n`);
    process.exit(1);
  }
}
