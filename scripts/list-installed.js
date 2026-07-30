#!/usr/bin/env node

const os = require('os');
const { discoverInstalledStates } = require('./lib/install-lifecycle');
const { SUPPORTED_INSTALL_TARGETS } = require('./lib/install-manifests');

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/list-installed.js [--target <${SUPPORTED_INSTALL_TARGETS.join('|')}>] [--json]

Inspect ECC install-state files for the current home/project context.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    targets: [],
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--target') {
      parsed.targets.push(args[index + 1] || null);
      index += 1;
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

function printHuman(records) {
  if (records.length === 0) {
    console.log('No ECC install-state files found for the current home/project context.');
    return;
  }

  console.log('Installed ECC targets:\n');
  for (const record of records) {
    if (record.error) {
      console.log(`- ${record.adapter.id}: INVALID (${record.error})`);
      continue;
    }

    const state = record.state;
    console.log(`- ${record.adapter.id}`);
    console.log(`  Root: ${state.target.root}`);
    console.log(`  Installed: ${state.installedAt}`);
    console.log(`  Requested profile: ${state.request.profile || '(legacy/custom)'}`);
    console.log(
      `  Effective profile: ${
        state.resolution.effectiveProfile
        || (state.resolution.selectionKind === 'custom' ? 'Custom' : '(not recorded)')
      }`
    );
    console.log(`  Modules: ${(state.resolution.selectedModules || []).join(', ') || '(none)'}`);
    console.log(`  Legacy languages: ${(state.request.legacyLanguages || []).join(', ') || '(none)'}`);
    console.log(`  Source version: ${state.source.repoVersion || '(unknown)'}`);
  }
}

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      showHelp(0);
    }

    const records = discoverInstalledStates({
      homeDir: process.env.HOME || os.homedir(),
      projectRoot: process.cwd(),
      targets: options.targets,
    }).filter(record => record.exists);

    if (options.json) {
      console.log(JSON.stringify({ records }, null, 2));
      return;
    }

    printHuman(records);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
