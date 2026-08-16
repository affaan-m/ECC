#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const PACKAGE_NAME = 'ecc-universal';
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const PACKAGE_PATH_PATTERN = /^release-artifacts\/ecc-universal-[0-9A-Za-z.+-]+\.tgz$/;

function parseEnvironment(environment = process.env, cwd = process.cwd()) {
  const packageValue = environment.ECC_RELEASE_PACKAGE;
  const hashValue = environment.ECC_RELEASE_SHA256;

  if (!packageValue) {
    throw new Error('ECC_RELEASE_PACKAGE must name the downloaded release .tgz');
  }
  if (!PACKAGE_PATH_PATTERN.test(String(packageValue))) {
    throw new Error('ECC_RELEASE_PACKAGE must name one ECC .tgz under release-artifacts');
  }
  if (!HASH_PATTERN.test(hashValue || '')) {
    throw new Error('ECC_RELEASE_SHA256 must be a 64-character SHA-256 digest');
  }

  return {
    packagePath: path.resolve(cwd, packageValue),
    expectedSha256: hashValue.toLowerCase(),
  };
}

function assertDownloadedArtifact(packagePath, cwd) {
  const artifactRoot = path.resolve(cwd, 'release-artifacts');
  const packageStat = fs.lstatSync(packagePath);
  if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
    throw new Error('Release package must be a regular, non-symlink file');
  }

  const realArtifactRoot = fs.realpathSync(artifactRoot);
  const realPackagePath = fs.realpathSync(packagePath);
  const relativePath = path.relative(realArtifactRoot, realPackagePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Release package escapes release-artifacts');
  }

  const archives = fs.readdirSync(realArtifactRoot).filter(name => name.endsWith('.tgz'));
  if (archives.length !== 1 || archives[0] !== path.basename(realPackagePath)) {
    throw new Error('Expected exactly one downloaded release archive');
  }
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertHash(actualSha256, expectedSha256) {
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Downloaded artifact SHA-256 ${actualSha256} does not match packed artifact ${expectedSha256}`
    );
  }
}

function createLifecycleEnvironment(baseEnvironment, homeDir) {
  const environment = {};
  const inheritedNames = [
    'CI',
    'ComSpec',
    'LANG',
    'LC_ALL',
    'NO_COLOR',
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'WINDIR',
  ];

  for (const name of inheritedNames) {
    if (baseEnvironment[name] !== undefined) {
      environment[name] = baseEnvironment[name];
    }
  }

  return {
    ...environment,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    XDG_DATA_HOME: path.join(homeDir, '.local', 'share'),
    NPM_CONFIG_CACHE: path.join(homeDir, '.npm'),
    NPM_CONFIG_USERCONFIG: path.join(homeDir, '.npmrc'),
  };
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }

  const expectedStatus = options.expectedStatus ?? 0;
  if (result.status !== expectedStatus) {
    throw new Error([
      `${options.label || command} exited ${result.status}, expected ${expectedStatus}.`,
      result.stdout ? `stdout:\n${result.stdout}` : '',
      result.stderr ? `stderr:\n${result.stderr}` : '',
    ].filter(Boolean).join('\n'));
  }

  return result;
}

function getNpmExecInvocation(publicArgs, environment, platform = process.platform) {
  const npmArgs = ['exec', '--offline', '--yes=false', '--', ...publicArgs];
  if (platform !== 'win32') {
    return { command: 'npm', args: npmArgs };
  }

  const commandParts = ['npm', ...npmArgs];
  for (const part of commandParts) {
    if (!/^[A-Za-z0-9_.=+/-]+$/.test(part)) {
      throw new Error(`Unsafe npm exec argument for Windows lifecycle: ${part}`);
    }
  }

  return {
    command: environment.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', commandParts.join(' ')],
  };
}

function installPackage(projectDir, packagePath, environment) {
  const projectManifest = {
    name: 'ecc-packed-artifact-lifecycle',
    version: '1.0.0',
    private: true,
    dependencies: {
      [PACKAGE_NAME]: pathToFileURL(packagePath).href,
    },
  };
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    `${JSON.stringify(projectManifest, null, 2)}\n`,
    'utf8'
  );

  if (process.platform === 'win32') {
    runProcess(
      environment.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', 'npm install --no-audit --no-fund'],
      { cwd: projectDir, env: environment, label: 'npm install packed artifact' }
    );
    return;
  }

  runProcess('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: projectDir,
    env: environment,
    label: 'npm install packed artifact',
  });
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not emit valid JSON: ${error.message}\n${result.stdout}`);
  }
}

function resolveManagedExistingPath(destinationPath, cursorRoot) {
  const normalizedRoot = fs.realpathSync(cursorRoot);
  const lexicalPath = path.resolve(destinationPath);
  const lexicalRelativePath = path.relative(normalizedRoot, lexicalPath);
  if (
    lexicalRelativePath === ''
    || lexicalRelativePath.startsWith('..')
    || path.isAbsolute(lexicalRelativePath)
    || !fs.existsSync(lexicalPath)
  ) {
    return null;
  }

  const pathStat = fs.lstatSync(lexicalPath);
  if (pathStat.isSymbolicLink()) {
    throw new Error(`Managed lifecycle path must not be a symlink: ${lexicalPath}`);
  }

  const realPath = fs.realpathSync(lexicalPath);
  const realRelativePath = path.relative(normalizedRoot, realPath);
  if (realRelativePath.startsWith('..') || path.isAbsolute(realRelativePath)) {
    throw new Error(`Managed lifecycle path escapes Cursor root: ${lexicalPath}`);
  }

  return { path: realPath, stat: pathStat };
}

function getManagedOperationSnapshot(state, cursorRoot) {
  const snapshot = [];
  for (const operation of state.operations) {
    if (operation.ownership !== 'managed' || typeof operation.destinationPath !== 'string') {
      continue;
    }
    const resolved = resolveManagedExistingPath(operation.destinationPath, cursorRoot);
    if (resolved) {
      snapshot.push({ path: resolved.path, isFile: resolved.stat.isFile() });
    }
  }
  return [...new Map(snapshot.map(entry => [entry.path, entry])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
}

function getOperationLedger(state) {
  return state.operations.map(operation => ({
    kind: operation.kind,
    moduleId: operation.moduleId,
    sourceRelativePath: operation.sourceRelativePath || null,
    destinationPath: operation.destinationPath,
    strategy: operation.strategy,
    ownership: operation.ownership,
    contentSha256: operation.contentSha256 || null,
  }));
}

function findDriftCandidate(state, cursorRoot) {
  const operation = state.operations.find(candidate => {
    if (candidate.kind !== 'copy-file' || typeof candidate.destinationPath !== 'string') {
      return false;
    }
    const resolved = resolveManagedExistingPath(candidate.destinationPath, cursorRoot);
    return resolved && resolved.stat.isFile();
  });

  assert.ok(operation, 'installed state must contain a managed Cursor file that can be drifted');
  return resolveManagedExistingPath(operation.destinationPath, cursorRoot).path;
}

function runLifecycle(options) {
  assert.ok(fs.existsSync(options.packagePath), `release package does not exist: ${options.packagePath}`);
  assertDownloadedArtifact(options.packagePath, process.cwd());
  assertHash(hashFile(options.packagePath), options.expectedSha256);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-packed-lifecycle-'));
  const homeDir = path.join(tempRoot, 'home');
  const projectDir = path.join(tempRoot, 'project');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  const environment = createLifecycleEnvironment(process.env, homeDir);

  try {
    installPackage(projectDir, options.packagePath, environment);

    const cursorRoot = path.join(projectDir, '.cursor');
    const statePath = path.join(cursorRoot, 'ecc-install-state.json');
    const sentinelPath = path.join(cursorRoot, 'user-sentinel.txt');
    fs.mkdirSync(cursorRoot, { recursive: true });
    fs.writeFileSync(sentinelPath, 'keep this user file\n', 'utf8');

    const runPublicCli = (publicArgs, commandOptions = {}) => {
      const invocation = getNpmExecInvocation(publicArgs, environment);
      return runProcess(invocation.command, invocation.args, {
        cwd: projectDir,
        env: environment,
        label: `npm exec -- ${publicArgs.join(' ')}`,
        ...commandOptions,
      });
    };
    const runCli = (args, commandOptions = {}) => runPublicCli(
      ['ecc', ...args],
      commandOptions
    );

    const setupHelp = runPublicCli(['ecc-universal', 'setup', '--help']);
    assert.match(setupHelp.stdout, /ECC guided setup/);
    assert.match(setupHelp.stdout, /ecc setup --mode claude-plugin/);

    parseJsonOutput(
      runCli(['install', '--profile', 'core', '--target', 'cursor', '--json']),
      'initial install'
    );
    assert.ok(fs.existsSync(statePath), 'initial install must write Cursor install-state');
    const initialState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const initialLedger = getOperationLedger(initialState);
    const managedSnapshot = getManagedOperationSnapshot(initialState, cursorRoot);
    assert.ok(managedSnapshot.length > 0, 'initial install must create managed Cursor files');

    parseJsonOutput(
      runCli(['install', '--profile', 'core', '--target', 'cursor', '--json']),
      'repeat install'
    );
    const repeatState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.deepStrictEqual(
      getOperationLedger(repeatState),
      initialLedger,
      'repeat install must preserve the complete ownership ledger'
    );
    for (const entry of managedSnapshot) {
      assert.ok(fs.existsSync(entry.path), `repeat install lost managed path: ${entry.path}`);
    }
    assert.strictEqual(
      fs.readFileSync(sentinelPath, 'utf8'),
      'keep this user file\n',
      'repeat install must preserve user-owned files'
    );

    const statusAfterInstall = parseJsonOutput(
      runCli(['status', '--json']),
      'status after install'
    );
    assert.strictEqual(statusAfterInstall.installHealth.status, 'healthy');
    assert.strictEqual(statusAfterInstall.installHealth.totalCount, 1);
    assert.strictEqual(statusAfterInstall.installStateProjection.status, 'ok');
    assert.strictEqual(statusAfterInstall.installStateProjection.warningCount, 0);
    assert.strictEqual(statusAfterInstall.readiness.status, 'ok');

    const healthyBeforeDrift = parseJsonOutput(
      runCli(['doctor', '--target', 'cursor', '--json']),
      'doctor before drift'
    );
    assert.strictEqual(healthyBeforeDrift.summary.errorCount, 0);
    assert.strictEqual(healthyBeforeDrift.summary.warningCount, 0);

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const driftPath = findDriftCandidate(state, cursorRoot);
    fs.appendFileSync(driftPath, '\nECC_PACKED_LIFECYCLE_DRIFT\n', 'utf8');

    const driftedDoctor = parseJsonOutput(
      runCli(['doctor', '--target', 'cursor', '--json'], { expectedStatus: 1 }),
      'doctor after drift'
    );
    assert.ok(
      driftedDoctor.summary.errorCount + driftedDoctor.summary.warningCount > 0,
      'doctor must detect induced managed-file drift'
    );

    const repair = parseJsonOutput(
      runCli(['repair', '--target', 'cursor', '--json']),
      'repair'
    );
    assert.ok(repair.summary.repairedCount > 0, 'repair must restore the drifted managed file');

    const healthyAfterRepair = parseJsonOutput(
      runCli(['doctor', '--target', 'cursor', '--json']),
      'doctor after repair'
    );
    assert.strictEqual(healthyAfterRepair.summary.errorCount, 0);
    assert.strictEqual(healthyAfterRepair.summary.warningCount, 0);

    const statusAfterRepair = parseJsonOutput(
      runCli(['status', '--json']),
      'status after repair'
    );
    assert.strictEqual(statusAfterRepair.installHealth.status, 'healthy');
    assert.strictEqual(statusAfterRepair.installHealth.totalCount, 1);
    assert.strictEqual(statusAfterRepair.installStateProjection.status, 'ok');
    assert.strictEqual(statusAfterRepair.installStateProjection.warningCount, 0);
    assert.strictEqual(statusAfterRepair.readiness.status, 'ok');

    parseJsonOutput(
      runCli(['uninstall', '--target', 'cursor', '--json']),
      'uninstall'
    );
    assert.ok(!fs.existsSync(statePath), 'uninstall must remove Cursor install-state');
    for (const entry of managedSnapshot) {
      assert.ok(!fs.existsSync(entry.path), `uninstall left managed path behind: ${entry.path}`);
    }
    assert.strictEqual(
      fs.readFileSync(sentinelPath, 'utf8'),
      'keep this user file\n',
      'uninstall must preserve user-owned files'
    );

    const statusAfterUninstall = parseJsonOutput(
      runCli(['status', '--json']),
      'status after uninstall'
    );
    assert.strictEqual(statusAfterUninstall.installHealth.status, 'missing');
    assert.strictEqual(statusAfterUninstall.installHealth.totalCount, 0);
    assert.strictEqual(statusAfterUninstall.installStateProjection.status, 'ok');
    assert.strictEqual(statusAfterUninstall.installStateProjection.warningCount, 0);
    assert.strictEqual(statusAfterUninstall.readiness.status, 'ok');

    return {
      packageSha256: options.expectedSha256,
      platform: process.platform,
      node: process.version,
      lifecycle: [
        'npm-install',
        'public-ecc-universal-setup',
        'cursor-install',
        'cursor-repeat-install',
        'doctor-clean',
        'status-installed',
        'doctor-drift',
        'repair',
        'doctor-repaired',
        'status-repaired',
        'uninstall',
        'status-uninstalled',
        'sentinel-preserved',
      ],
    };
  } finally {
    try {
      fs.rmSync(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch (cleanupError) {
      process.stderr.write(
        `Could not remove lifecycle temp root ${tempRoot}: ${cleanupError.message}\n`
      );
    }
  }
}

function main() {
  try {
    const report = runLifecycle(parseEnvironment());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Packed-artifact lifecycle failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertDownloadedArtifact,
  assertHash,
  createLifecycleEnvironment,
  getNpmExecInvocation,
  hashFile,
  parseEnvironment,
  runLifecycle,
};

if (require.main === module) {
  main();
}
