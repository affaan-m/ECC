#!/usr/bin/env node

const os = require('os');
const path = require('path');
const { uninstallInstalledStates } = require('./lib/install-lifecycle');
const { SUPPORTED_INSTALL_TARGETS } = require('./lib/install-manifests');
const { exitFeedbackLines } = require('./lib/feedback-links');
const {
  detectLegacyCodexSync,
  uninstallLegacyCodexSync,
} = require('./lib/codex-legacy-sync');

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/uninstall.js [--target <${SUPPORTED_INSTALL_TARGETS.join('|')}>] [--legacy-codex-sync] [--dry-run] [--json]

Remove ECC-managed files recorded in install-state for the current context.
When no install-state is found, the uninstaller also detects and removes
artifacts left by the older scripts/sync-ecc-to-codex.sh installer.
Use --legacy-codex-sync to force the legacy path explicitly.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    targets: [],
    dryRun: false,
    json: false,
    legacyCodexSync: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--target') {
      parsed.targets.push(args[index + 1] || null);
      index += 1;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--legacy-codex-sync') {
      parsed.legacyCodexSync = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHuman(result) {
  if (result.results.length === 0) {
    console.log('No ECC install-state files found for the current home/project context.');
    return;
  }

  console.log('Uninstall summary:\n');
  for (const entry of result.results) {
    console.log(`- ${entry.adapter.id}`);
    console.log(`  Status: ${entry.status.toUpperCase()}`);
    console.log(`  Install-state: ${entry.installStatePath}`);

    if (entry.error) {
      console.log(`  Error: ${entry.error}`);
      continue;
    }

    if (entry.warning) {
      console.log(`  Warning: ${entry.warning}`);
    }
    if (Array.isArray(entry.retainedPaths) && entry.retainedPaths.length > 0) {
      console.log(`  Retained paths: ${entry.retainedPaths.length}`);
      for (const retainedPath of entry.retainedPaths) {
        console.log(`    - ${retainedPath}`);
      }
    }

    const candidatePaths = result.dryRun ? entry.plannedRemovals : entry.removedPaths;
    const paths = Array.isArray(candidatePaths) ? candidatePaths : [];
    console.log(`  ${result.dryRun ? 'Planned removals' : 'Removed paths'}: ${paths.length}`);
  }

  console.log(`\nSummary: checked=${result.summary.checkedCount}, ${result.dryRun ? 'planned' : 'uninstalled'}=${result.dryRun ? result.summary.plannedRemovalCount : result.summary.uninstalledCount}, partial=${result.summary.partialCount}, errors=${result.summary.errorCount}`);

  if (!result.dryRun) {
    console.log(`\n${exitFeedbackLines().join('\n')}`);
  }
}

function legacyCodexSyncDetected(codexHome) {
  return detectLegacyCodexSync(codexHome);
}

function printLegacy(result, dryRun) {
  console.log('Legacy Codex sync cleanup summary:\n');
  console.log(`Status: ${result.status.toUpperCase()}`);
  const paths = dryRun ? result.plannedRemovals : result.removedPaths;
  console.log(`${dryRun ? 'Planned changes' : 'Removed paths'}: ${paths.length}`);
  if (result.retainedPaths.length > 0) {
    console.log(`Retained paths: ${result.retainedPaths.length}`);
    for (const retainedPath of result.retainedPaths) console.log(`  - ${retainedPath}`);
  }
  for (const warning of result.warnings) console.log(`Warning: ${warning}`);
}

function codexHomePath() {
  return process.env.CODEX_HOME || path.join(process.env.HOME || os.homedir(), '.codex');
}

function includesCodexTarget(targets) {
  return targets.length === 0 || targets.includes('codex');
}

async function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      showHelp(0);
    }

    if (options.legacyCodexSync && options.targets.length > 0) {
      throw new Error('--legacy-codex-sync cannot be combined with --target');
    }

    let result;
    let mode = 'install-state';

    if (options.legacyCodexSync) {
      result = uninstallLegacyCodexSync({
        codexHome: codexHomePath(),
        dryRun: options.dryRun,
      });
      mode = 'legacy-codex-sync';
    } else {
      result = uninstallInstalledStates({
        homeDir: process.env.HOME || os.homedir(),
        projectRoot: process.cwd(),
        targets: options.targets,
        dryRun: options.dryRun,
      });

      if (
        result.results.length === 0
        && includesCodexTarget(options.targets)
        && legacyCodexSyncDetected(codexHomePath())
      ) {
        result = uninstallLegacyCodexSync({
          codexHome: codexHomePath(),
          dryRun: options.dryRun,
        });
        mode = 'legacy-codex-sync';
      }

      if (mode === 'install-state' && !options.dryRun) {
        const { reconcileCanonicalInstallStates } = require('./lib/install-state-store-sync');
        result.installStateProjection = await reconcileCanonicalInstallStates({
          homeDir: process.env.HOME || os.homedir(),
          projectRoot: process.cwd(),
          targets: options.targets,
        });
      }
    }

    const hasErrors = mode === 'legacy-codex-sync'
      ? result.status === 'partial'
      : result.summary.errorCount > 0 || result.summary.partialCount > 0;

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (mode === 'legacy-codex-sync') {
      printLegacy(result, options.dryRun);
    } else {
      printHuman(result);
    }

    process.exitCode = hasErrors ? 1 : 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
