#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { discoverInstalledStates } = require('./lib/install-lifecycle');
const { getRecordedHookConsent } = require('./lib/install/hook-consent');
const { SUPPORTED_INSTALL_TARGETS } = require('./lib/install-manifests');
const grokFixtureUpgrade = require('./lib/grok-fixture-upgrade');

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
  const hookConsent = getRecordedHookConsent(state);

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

  if (hookConsent === 'enabled') {
    args.push('--enable-hooks');
  } else if (hookConsent === 'declined') {
    args.push('--no-hooks');
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

function legacyMigrationWarning(record) {
  if (record.legacyLayout === 'opencode') {
    return 'Found only a legacy OpenCode ~/.opencode install-state. Run the OpenCode installer once to migrate it to the configured OpenCode directory before auto-updating.';
  }
  return 'Found only a legacy Antigravity .agent install-state. Run the Antigravity installer once to migrate it to .agents before auto-updating.';
}

function runAutoUpdate(options = {}, dependencies = {}) {
  const discover = dependencies.discoverInstalledStates || discoverInstalledStates;
  const execute = dependencies.runExternalCommand || runExternalCommand;
  const homeDir = options.homeDir || process.env.HOME || os.homedir();
  const projectRoot = options.projectRoot || process.cwd();
  const requestedRepoRoot = options.repoRoot ? validateRepoRoot(options.repoRoot) : null;
  const discoveredRecords = discover({
    homeDir,
    projectRoot,
    targets: options.targets
  });
  const records = discoveredRecords.filter(record => record.exists && !record.legacy);
  const legacyRecords = discoveredRecords.filter(record => record.exists && record.legacy);
  const warnings = records.length === 0 && legacyRecords.length > 0
    ? [...new Set(legacyRecords.map(legacyMigrationWarning))]
    : [];

  const results = [];
  if (records.length === 0) {
    return {
      dryRun: Boolean(options.dryRun),
      repoRoot: requestedRepoRoot,
      results,
      warnings,
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
      warnings,
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
  const grokHome = options.grokHome || path.join(homeDir, '.grok');
  const classify = dependencies.classifyGrokFixtureUpgrade || grokFixtureUpgrade.classifyGrokFixtureUpgrade;
  const probeIncoming = dependencies.probeGrokSupportFromGit || grokFixtureUpgrade.probeGrokSupportFromGit;
  const snapshotFiles = dependencies.snapshotFixtureFiles || grokFixtureUpgrade.snapshotFixtureFiles;
  const applyFixture = dependencies.applyGrokFixtureUpgrade || grokFixtureUpgrade.applyGrokFixtureUpgrade;
  const detectDest = dependencies.detectDestFixture || grokFixtureUpgrade.detectDestFixture;
  const readPolicy = dependencies.readFixturePolicy || grokFixtureUpgrade.readFixturePolicy;
  const listChanged = dependencies.listChangedPaths || grokFixtureUpgrade.listChangedPaths;
  const isNecessary = dependencies.isFixtureNecessary || grokFixtureUpgrade.isFixtureNecessary;

  let grokFixture = { flow: 'none' };

  if (!options.dryRun) {
    execute('git', ['fetch', '--all', '--prune'], { cwd: repoRoot, env });
    const destPresent = detectDest(grokHome);
    const policy = readPolicy(grokHome);
    let decision = { flow: 'none', reason: 'no-fixture', cleanup: null };
    let incoming = null;
    let snapshot = null;
    if (destPresent || (policy && policy.status === 'active')) {
      incoming = probeIncoming({ execute, repoRoot, ref: 'FETCH_HEAD' });
      decision = classify({
        destPresent,
        policyStatus: policy ? policy.status : null,
        incoming,
        changedPaths: listChanged(execute, repoRoot, 'HEAD', 'FETCH_HEAD'),
      });
      if (decision.flow === 'perforated') {
        snapshot = snapshotFiles(repoRoot);
      }
    }
    execute('git', ['pull', '--ff-only'], { cwd: repoRoot, env });
    if (decision.flow !== 'none') {
      const applied = applyFixture({
        decision,
        repoRoot,
        grokHome,
        snapshot,
        dryRun: false,
      });
      grokFixture = {
        ...decision,
        ...applied,
        incoming,
        necessary: isNecessary({ destPresent, incoming }),
      };
      if (
        (decision.flow === 'perforated' || decision.flow === 'passthrough')
        && fs.existsSync(path.join(grokHome, 'config.toml'))
      ) {
        try {
          execute('bash', [path.join(repoRoot, 'scripts', 'sync-ecc-to-grok.sh')], {
            cwd: repoRoot,
            env: { ...env, GROK_HOME: grokHome },
          });
          grokFixture.destSync = 'applied';
        } catch (error) {
          grokFixture.destSync = 'error';
          grokFixture.destSyncError = error.message;
        }
      }
    }
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
    grokFixture,
    results,
    warnings,
    summary: {
      checkedCount: results.length,
      updatedCount: results.filter(result => result.status === 'updated' || result.status === 'planned').length,
      errorCount: results.filter(result => result.status === 'error').length
    }
  };
}

function printHuman(result) {
  if (result.results.length === 0) {
    const hasWarnings = Array.isArray(result.warnings) && result.warnings.length > 0;
    console.log(hasWarnings
      ? 'No active ECC install-state files found for the current home/project context.'
      : 'No ECC install-state files found for the current home/project context.');
    for (const warning of Array.isArray(result.warnings) ? result.warnings : []) {
      console.log(`Warning: ${warning}`);
    }
    return;
  }

  console.log(`${result.dryRun ? 'Auto-update dry run' : 'Auto-update summary'}:\n`);
  if (result.repoRoot) {
    console.log(`Repo root: ${result.repoRoot}\n`);
  }
  if (result.grokFixture && result.grokFixture.flow && result.grokFixture.flow !== 'none') {
    console.log(
      `Grok fixture: flow=${result.grokFixture.flow} necessary=${result.grokFixture.necessary ? 'yes' : 'no'} `
      + `(${result.grokFixture.reason || 'n/a'})\n`
    );
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
