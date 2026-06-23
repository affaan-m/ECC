#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { discoverInstalledStates } = require('./lib/install-lifecycle');
const { SUPPORTED_INSTALL_TARGETS } = require('./lib/install-manifests');

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/auto-update.js [--target <${SUPPORTED_INSTALL_TARGETS.join('|')}>] [--repo-root <path>] [--dry-run] [--json]

Pull the latest ECC repo changes and reinstall the current context's managed targets
using the original install-state request.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    targets: [],
    repoRoot: null,
    dryRun: false,
    json: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--target') {
      parsed.targets.push(args[index + 1] || null);
      index += 1;
    } else if (arg === '--repo-root') {
      parsed.repoRoot = args[index + 1] || null;
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

function deriveRepoRootFromState(state) {
  const operations = Array.isArray(state && state.operations) ? state.operations : [];

  for (const operation of operations) {
    if (typeof operation.sourcePath !== 'string' || !operation.sourcePath.trim()) {
      continue;
    }

    if (typeof operation.sourceRelativePath !== 'string' || !operation.sourceRelativePath.trim()) {
      continue;
    }

    const relativeParts = operation.sourceRelativePath.split(/[\\/]+/).filter(Boolean);

    if (relativeParts.length === 0) {
      continue;
    }

    let repoRoot = path.resolve(operation.sourcePath);
    for (let index = 0; index < relativeParts.length; index += 1) {
      repoRoot = path.dirname(repoRoot);
    }

    return repoRoot;
  }

  throw new Error('Unable to infer ECC repo root from install-state operations');
}

function buildInstallApplyArgs(record) {
  const state = record.state;
  const target = state.target.target || record.adapter.target;
  const request = state.request || {};
  const args = [];

  if (target) {
    args.push('--target', target);
  }

  if (request.profile) {
    args.push('--profile', request.profile);
  }

  if (Array.isArray(request.modules) && request.modules.length > 0) {
    args.push('--modules', request.modules.join(','));
  }

  for (const componentId of Array.isArray(request.includeComponents) ? request.includeComponents : []) {
    args.push('--with', componentId);
  }

  for (const componentId of Array.isArray(request.excludeComponents) ? request.excludeComponents : []) {
    args.push('--without', componentId);
  }

  for (const language of Array.isArray(request.legacyLanguages) ? request.legacyLanguages : []) {
    args.push(language);
  }

  return args;
}

function determineInstallCwd(record, repoRoot) {
  if (record.adapter.kind === 'project') {
    return path.dirname(record.state.target.root);
  }

  return repoRoot;
}

// Recognized ECC package names. A repo root is only trusted to run its
// install-apply.js if its package.json identifies it as ECC — otherwise a
// cloned project that ships a nested `evil/{package.json,scripts/install-apply.js}`
// could drive auto-update into executing attacker code (GHSA-hfpv-w6mp-5g95).
const ECC_PACKAGE_NAMES = new Set(['ecc-universal', 'everything-claude-code']);

function validateRepoRoot(repoRoot) {
  const normalized = path.resolve(repoRoot);
  const packageJsonPath = path.join(normalized, 'package.json');
  const installApplyPath = path.join(normalized, 'scripts', 'install-apply.js');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Invalid ECC repo root: missing package.json at ${packageJsonPath}`);
  }

  if (!fs.existsSync(installApplyPath)) {
    throw new Error(`Invalid ECC repo root: missing install script at ${installApplyPath}`);
  }

  let pkgName = null;
  try {
    pkgName = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).name;
  } catch {
    throw new Error(`Invalid ECC repo root: unreadable package.json at ${packageJsonPath}`);
  }
  if (!ECC_PACKAGE_NAMES.has(pkgName)) {
    throw new Error(`Refusing to run install from untrusted repo root ${normalized}: package.json name '${pkgName}' is not an official ECC package.`);
  }

  return normalized;
}

function runExternalCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const errorOutput = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${errorOutput ? `: ${errorOutput}` : ''}`);
  }

  return result;
}

function runAutoUpdate(options = {}, dependencies = {}) {
  const discover = dependencies.discoverInstalledStates || discoverInstalledStates;
  const execute = dependencies.runExternalCommand || runExternalCommand;
  const homeDir = options.homeDir || process.env.HOME || os.homedir();
  const projectRoot = options.projectRoot || process.cwd();
  const requestedRepoRoot = options.repoRoot ? validateRepoRoot(options.repoRoot) : null;
  const records = discover({
    homeDir,
    projectRoot,
    targets: options.targets
  }).filter(record => record.exists);

  const results = [];
  if (records.length === 0) {
    return {
      dryRun: Boolean(options.dryRun),
      repoRoot: requestedRepoRoot,
      results,
      summary: {
        checkedCount: 0,
        updatedCount: 0,
        errorCount: 0
      }
    };
  }

  const validRecords = [];
  const inferredRepoRoots = [];
  for (const record of records) {
    if (record.error || !record.state) {
      results.push({
        adapter: record.adapter,
        installStatePath: record.installStatePath,
        status: 'error',
        error: record.error || 'No valid install-state available'
      });
      continue;
    }

    const recordRepoRoot = requestedRepoRoot || validateRepoRoot(deriveRepoRootFromState(record.state));
    inferredRepoRoots.push(recordRepoRoot);
    validRecords.push({
      record,
      repoRoot: recordRepoRoot
    });
  }

  if (!requestedRepoRoot) {
    const uniqueRepoRoots = [...new Set(inferredRepoRoots)];
    if (uniqueRepoRoots.length > 1) {
      throw new Error(`Multiple ECC repo roots detected: ${uniqueRepoRoots.join(', ')}`);
    }
  }

  const repoRoot = requestedRepoRoot || inferredRepoRoots[0] || null;
  if (!repoRoot) {
    return {
      dryRun: Boolean(options.dryRun),
      repoRoot,
      results,
      summary: {
        checkedCount: results.length,
        updatedCount: 0,
        errorCount: results.length
      }
    };
  }

  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir
  };

  if (!options.dryRun) {
    execute('git', ['fetch', '--all', '--prune'], { cwd: repoRoot, env });
    execute('git', ['pull', '--ff-only'], { cwd: repoRoot, env });
  }

  for (const entry of validRecords) {
    const installArgs = buildInstallApplyArgs(entry.record);
    const args = [path.join(repoRoot, 'scripts', 'install-apply.js'), ...installArgs, '--json'];

    if (options.dryRun) {
      args.push('--dry-run');
    }

    try {
      const commandResult = execute(process.execPath, args, {
        cwd: determineInstallCwd(entry.record, repoRoot),
        env
      });

      let payload = null;
      if (commandResult.stdout && commandResult.stdout.trim()) {
        payload = JSON.parse(commandResult.stdout);
      }

      results.push({
        adapter: entry.record.adapter,
        installStatePath: entry.record.installStatePath,
        repoRoot,
        cwd: determineInstallCwd(entry.record, repoRoot),
        installArgs,
        status: options.dryRun ? 'planned' : 'updated',
        payload
      });
    } catch (error) {
      results.push({
        adapter: entry.record.adapter,
        installStatePath: entry.record.installStatePath,
        repoRoot,
        installArgs,
        status: 'error',
        error: error.message
      });
    }
  }

  return {
    dryRun: Boolean(options.dryRun),
    repoRoot,
    results,
    summary: {
      checkedCount: results.length,
      updatedCount: results.filter(result => result.status === 'updated' || result.status === 'planned').length,
      errorCount: results.filter(result => result.status === 'error').length
    }
  };
}

function printHuman(result) {
  if (result.results.length === 0) {
    console.log('No ECC install-state files found for the current home/project context.');
    return;
  }

  console.log(`${result.dryRun ? 'Auto-update dry run' : 'Auto-update summary'}:\n`);
  if (result.repoRoot) {
    console.log(`Repo root: ${result.repoRoot}\n`);
  }

  for (const entry of result.results) {
    console.log(`- ${entry.adapter.id}`);
    console.log(`  Status: ${entry.status.toUpperCase()}`);
    console.log(`  Install-state: ${entry.installStatePath}`);
    if (entry.error) {
      console.log(`  Error: ${entry.error}`);
      continue;
    }

    console.log(`  Reinstall args: ${entry.installArgs.join(' ') || '(none)'}`);
  }

  console.log(`\nSummary: checked=${result.summary.checkedCount}, ${result.dryRun ? 'planned' : 'updated'}=${result.summary.updatedCount}, errors=${result.summary.errorCount}`);
}

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      showHelp(0);
    }

    const result = runAutoUpdate({
      homeDir: process.env.HOME || os.homedir(),
      projectRoot: process.cwd(),
      targets: options.targets,
      repoRoot: options.repoRoot,
      dryRun: options.dryRun
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }

    process.exitCode = result.summary.errorCount > 0 ? 1 : 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  deriveRepoRootFromState,
  buildInstallApplyArgs,
  determineInstallCwd,
  runAutoUpdate
};
