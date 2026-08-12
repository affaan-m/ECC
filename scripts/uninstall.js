#!/usr/bin/env node

const os = require('os');
const { uninstallInstalledStates } = require('./lib/install-lifecycle');
const { SUPPORTED_INSTALL_TARGETS } = require('./lib/install-manifests');
const { exitFeedbackLines } = require('./lib/feedback-links');

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/uninstall.js [--target <${SUPPORTED_INSTALL_TARGETS.join('|')}>] [--dry-run] [--json]

Remove ECC-managed files recorded in install-state for the current context.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    targets: [],
    dryRun: false,
    json: false,
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

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      showHelp(0);
    }

    const result = uninstallInstalledStates({
      homeDir: process.env.HOME || os.homedir(),
      projectRoot: process.cwd(),
      targets: options.targets,
      dryRun: options.dryRun,
    });
    const hasErrors = result.summary.errorCount > 0 || result.summary.partialCount > 0;

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
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
