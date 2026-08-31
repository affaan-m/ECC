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
    if (!/^[A-Za-z0-9_.=+,:/-]+$/.test(part)) {
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

function fakeClaudeProviderMain() {
  const fs = require('fs');
  const path = require('path');
  const args = process.argv.slice(2);
  const statePath = process.env.ECC_TEST_CLAUDE_STATE;
  const callsPath = process.env.ECC_TEST_CLAUDE_CALLS;

  if (!statePath || !callsPath) {
    process.stderr.write('Fake Claude requires explicit state and call-log paths.\n');
    process.exit(2);
  }

  fs.appendFileSync(callsPath, `${JSON.stringify(args)}\n`);
  const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const writeState = state => fs.writeFileSync(
    statePath,
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8'
  );
  const createReadArtifacts = () => {
    if (process.env.ECC_TEST_CLAUDE_CREATE_READ_ARTIFACTS !== '1') return;
    const configDir = process.env.CLAUDE_CONFIG_DIR;
    const backupDir = path.join(configDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, '.claude.json'), '{"providerRead":true}\n', 'utf8');
    fs.writeFileSync(
      path.join(backupDir, `.claude.json.backup.${process.pid}`),
      '{"providerRead":true}\n',
      'utf8'
    );
  };

  const state = readState();
  const joined = args.join(' ');
  if (joined === 'plugin list --json') {
    createReadArtifacts();
    process.stdout.write(JSON.stringify(state.plugins || []));
    return;
  }
  if (joined === 'plugin marketplace list --json') {
    createReadArtifacts();
    process.stdout.write(JSON.stringify(state.marketplaces || []));
    return;
  }
  if (joined.startsWith('plugin marketplace add ')) {
    writeState({
      ...state,
      marketplaces: [{
        name: 'ecc',
        repo: 'affaan-m/ECC',
        scope: 'user',
        source: 'github',
      }],
    });
    return;
  }
  if (joined === 'plugin marketplace update ecc') {
    return;
  }
  if (joined.startsWith('plugin install ecc@ecc ')) {
    writeState({
      ...state,
      plugins: [{ enabled: true, id: 'ecc@ecc', scope: 'user', version: '2.2.0' }],
    });
    return;
  }
  if (joined.startsWith('plugin update ecc@ecc ')) {
    writeState({
      ...state,
      plugins: (state.plugins || []).map(plugin => (
        plugin.id === 'ecc@ecc' && plugin.scope === 'user'
          ? { ...plugin, enabled: true, version: '2.2.0' }
          : plugin
      )),
    });
    return;
  }

  process.stderr.write(`Unsupported fake Claude invocation: ${JSON.stringify(args)}\n`);
  process.exit(2);
}

function createFakeClaudeExecutable(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const fakeScriptPath = path.join(binDir, 'fake-claude.js');
  fs.writeFileSync(
    fakeScriptPath,
    `'use strict';\n(${fakeClaudeProviderMain.toString()})();\n`,
    'utf8'
  );

  const launcherPath = path.join(binDir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
  if (process.platform === 'win32') {
    fs.writeFileSync(
      launcherPath,
      `@echo off\r\n"${process.execPath}" "${fakeScriptPath}" %*\r\n`,
      'utf8'
    );
  } else {
    fs.writeFileSync(
      launcherPath,
      `#!/bin/sh\nexec "${process.execPath}" "${fakeScriptPath}" "$@"\n`,
      'utf8'
    );
    fs.chmodSync(launcherPath, 0o755);
  }
  return launcherPath;
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function isFakeClaudeMutation(args) {
  return ![
    'plugin list --json',
    'plugin marketplace list --json',
  ].includes(args.join(' '));
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

function runTargetSmoke(options) {
  parseJsonOutput(
    options.runCli([
      'install',
      '--modules', 'workflow-quality',
      '--target', options.target,
      '--enable-hooks',
      '--json',
    ]),
    `${options.target} packed install`
  );
  const statePath = path.join(options.targetRoot, 'ecc-install-state.json');
  const installedSkillPath = path.join(
    options.targetRoot,
    'skills',
    'skill-comply',
    'SKILL.md'
  );
  assert.ok(fs.existsSync(statePath), `${options.target} install-state must exist`);
  assert.ok(
    fs.existsSync(installedSkillPath),
    `${options.target} must install skill-comply from the packed archive`
  );

  const doctor = parseJsonOutput(
    options.runCli(['doctor', '--target', options.target, '--json']),
    `${options.target} packed doctor`
  );
  assert.strictEqual(doctor.summary.errorCount, 0);

  const uninstall = parseJsonOutput(
    options.runCli(['uninstall', '--target', options.target, '--json']),
    `${options.target} packed uninstall`
  );
  assert.strictEqual(uninstall.summary.errorCount, 0);
  assert.ok(!fs.existsSync(statePath), `${options.target} uninstall must remove install-state`);
  assert.ok(
    !fs.existsSync(installedSkillPath),
    `${options.target} uninstall must remove the installed skill`
  );
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

    for (const credentialName of [
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'KIMI_API_KEY',
      'MOONSHOT_API_KEY',
    ]) {
      assert.strictEqual(
        environment[credentialName],
        undefined,
        `packed lifecycle must not provide ${credentialName}`
      );
    }

    const fakeClaudeBinDir = path.join(tempRoot, 'fake-claude-bin');
    const fakeClaudeStatePath = path.join(tempRoot, 'fake-claude-state.json');
    const fakeClaudeCallsPath = path.join(tempRoot, 'fake-claude-calls.jsonl');
    const claudeConfigDir = path.join(homeDir, '.claude');
    const claudeSetupSentinel = path.join(claudeConfigDir, 'user-sentinel.txt');
    createFakeClaudeExecutable(fakeClaudeBinDir);
    fs.writeFileSync(
      fakeClaudeStatePath,
      `${JSON.stringify({ marketplaces: [], plugins: [] }, null, 2)}\n`,
      'utf8'
    );
    fs.mkdirSync(claudeConfigDir, { recursive: true });
    fs.writeFileSync(claudeSetupSentinel, 'keep this Claude user file\n', 'utf8');
    const claudeSetupEnvironment = {
      ...environment,
      CLAUDE_CONFIG_DIR: claudeConfigDir,
      ECC_TEST_CLAUDE_CALLS: fakeClaudeCallsPath,
      ECC_TEST_CLAUDE_CREATE_READ_ARTIFACTS: '1',
      ECC_TEST_CLAUDE_STATE: fakeClaudeStatePath,
      PATH: `${fakeClaudeBinDir}${path.delimiter}${environment.PATH || environment.Path || ''}`,
      Path: `${fakeClaudeBinDir}${path.delimiter}${environment.Path || environment.PATH || ''}`,
    };
    const claudeSetupArgs = [
      'ecc-universal', 'setup',
      '--mode', 'claude-plugin',
      '--scope', 'user',
    ];
    const claudeSetupStateBeforeDryRun = fs.readFileSync(fakeClaudeStatePath, 'utf8');
    const claudeConfigBeforeDryRun = fs.readdirSync(claudeConfigDir).sort();
    const claudeSetupDryRun = parseJsonOutput(
      runPublicCli(
        [...claudeSetupArgs, '--hooks', 'standard', '--dry-run', '--json'],
        { env: claudeSetupEnvironment }
      ),
      'packed Claude setup dry-run'
    );
    assert.strictEqual(claudeSetupDryRun.action, 'would-install');
    assert.strictEqual(claudeSetupDryRun.dryRun, true);
    assert.strictEqual(claudeSetupDryRun.scope, 'user');
    assert.deepStrictEqual(
      fs.readdirSync(claudeConfigDir).sort(),
      claudeConfigBeforeDryRun,
      'Claude setup dry-run must not mutate setup state'
    );
    assert.strictEqual(
      fs.readFileSync(fakeClaudeStatePath, 'utf8'),
      claudeSetupStateBeforeDryRun,
      'Claude setup dry-run must not mutate fake provider state'
    );
    assert.ok(
      readJsonLines(fakeClaudeCallsPath).every(args => !isFakeClaudeMutation(args)),
      'Claude setup dry-run invoked a provider mutation'
    );
    assert.strictEqual(
      fs.readFileSync(claudeSetupSentinel, 'utf8'),
      'keep this Claude user file\n',
      'Claude setup dry-run must preserve user-owned files'
    );

    const setupGitPreflight = runProcess('git', ['--version'], {
      cwd: projectDir,
      env: claudeSetupEnvironment,
      label: 'Claude setup Git preflight',
    });
    assert.match(setupGitPreflight.stdout, /git version/i);
    const runPackedClaudeSetup = hooks => parseJsonOutput(
      runPublicCli(
        [...claudeSetupArgs, '--hooks', hooks, '--yes', '--json'],
        { env: claudeSetupEnvironment }
      ),
      `packed Claude setup hooks=${hooks}`
    );
    const claudeInitialSetup = runPackedClaudeSetup('standard');
    assert.strictEqual(claudeInitialSetup.action, 'installed');
    assert.strictEqual(claudeInitialSetup.hooks, 'standard');
    assert.strictEqual(claudeInitialSetup.scope, 'user');
    const claudeUpdatedSetup = runPackedClaudeSetup('strict');
    assert.strictEqual(claudeUpdatedSetup.action, 'updated');
    assert.strictEqual(claudeUpdatedSetup.hooks, 'strict');
    assert.strictEqual(claudeUpdatedSetup.scope, 'user');

    const fakeClaudeState = JSON.parse(fs.readFileSync(fakeClaudeStatePath, 'utf8'));
    assert.deepStrictEqual(fakeClaudeState.plugins, [
      { enabled: true, id: 'ecc@ecc', scope: 'user', version: '2.2.0' },
    ]);
    assert.deepStrictEqual(fakeClaudeState.marketplaces, [
      { name: 'ecc', repo: 'affaan-m/ECC', scope: 'user', source: 'github' },
    ]);
    const fakeClaudeCalls = readJsonLines(fakeClaudeCallsPath).map(args => args.join(' '));
    assert.ok(
      fakeClaudeCalls.some(call => call.startsWith('plugin marketplace add ')),
      'initial packed Claude setup must add the official marketplace'
    );
    assert.ok(
      fakeClaudeCalls.includes('plugin marketplace update ecc'),
      'repeat packed Claude setup must update the official marketplace'
    );
    assert.ok(
      fakeClaudeCalls.some(call => call.startsWith('plugin install ecc@ecc ')),
      'initial packed Claude setup must install ecc@ecc'
    );
    assert.ok(
      fakeClaudeCalls.includes('plugin update ecc@ecc --scope user'),
      'repeat packed Claude setup must update ecc@ecc'
    );
    const claudeSettings = JSON.parse(
      fs.readFileSync(path.join(claudeConfigDir, 'settings.json'), 'utf8')
    );
    assert.strictEqual(
      claudeSettings.pluginConfigs['ecc@ecc'].options.hook_profile,
      'strict'
    );
    assert.strictEqual(
      fs.readFileSync(claudeSetupSentinel, 'utf8'),
      'keep this Claude user file\n',
      'packed Claude setup must preserve user-owned files'
    );

    const guidedKimiRoot = path.join(projectDir, '.kimi-code');
    const guidedKimiStatePath = path.join(guidedKimiRoot, 'ecc-install-state.json');
    const guidedKimiSkillPath = path.join(
      guidedKimiRoot,
      'skills',
      'skill-comply',
      'SKILL.md'
    );
    const guidedKimiSentinel = path.join(guidedKimiRoot, 'user-sentinel.txt');
    fs.mkdirSync(guidedKimiRoot, { recursive: true });
    fs.writeFileSync(guidedKimiSentinel, 'keep this Kimi user file\n', 'utf8');
    const guidedKimiBeforeDryRun = fs.readdirSync(guidedKimiRoot).sort();
    const guidedKimiInstallArgs = [
      'ecc-universal', 'install', '--guided',
      '--harness', 'kimi',
      '--profile', 'core',
    ];
    const guidedKimiDryRun = parseJsonOutput(
      runPublicCli([...guidedKimiInstallArgs, '--dry-run', '--json']),
      'guided Kimi dry-run'
    );
    assert.strictEqual(guidedKimiDryRun.dryRun, true);
    assert.deepStrictEqual(
      fs.readdirSync(guidedKimiRoot).sort(),
      guidedKimiBeforeDryRun,
      'guided Kimi dry-run must not mutate the Kimi target'
    );
    assert.ok(!fs.existsSync(guidedKimiStatePath), 'guided Kimi dry-run wrote install-state');
    assert.ok(!fs.existsSync(guidedKimiSkillPath), 'guided Kimi dry-run installed a skill');
    assert.strictEqual(
      fs.readFileSync(guidedKimiSentinel, 'utf8'),
      'keep this Kimi user file\n',
      'guided Kimi dry-run must preserve user-owned files'
    );

    const runGuidedKimiInstall = () => parseJsonOutput(
      runPublicCli([...guidedKimiInstallArgs, '--yes', '--json']),
      'guided Kimi install'
    );
    const guidedKimiInitialInstall = runGuidedKimiInstall();
    assert.strictEqual(guidedKimiInitialInstall.dryRun, false);
    assert.strictEqual(guidedKimiInitialInstall.result.status, 'complete');
    assert.ok(fs.existsSync(guidedKimiStatePath), 'guided Kimi install-state must exist');
    assert.ok(
      fs.existsSync(guidedKimiSkillPath),
      'guided Kimi install must copy skill-comply from the packed archive'
    );
    const guidedKimiInitialState = JSON.parse(fs.readFileSync(guidedKimiStatePath, 'utf8'));
    const guidedKimiInitialLedger = getOperationLedger(guidedKimiInitialState);
    const guidedKimiManagedSnapshot = getManagedOperationSnapshot(
      guidedKimiInitialState,
      guidedKimiRoot
    );
    assert.ok(
      guidedKimiManagedSnapshot.length > 0,
      'guided Kimi install must create managed files'
    );

    const guidedKimiRepeatInstall = runGuidedKimiInstall();
    assert.strictEqual(guidedKimiRepeatInstall.result.status, 'complete');
    const guidedKimiRepeatState = JSON.parse(fs.readFileSync(guidedKimiStatePath, 'utf8'));
    assert.deepStrictEqual(
      getOperationLedger(guidedKimiRepeatState),
      guidedKimiInitialLedger,
      'repeat guided Kimi install must preserve the complete ownership ledger'
    );
    assert.strictEqual(
      fs.readFileSync(guidedKimiSentinel, 'utf8'),
      'keep this Kimi user file\n',
      'repeat guided Kimi install must preserve user-owned files'
    );

    const guidedKimiDoctor = parseJsonOutput(
      runPublicCli(['ecc', 'doctor', '--target', 'kimi', '--json']),
      'guided Kimi doctor'
    );
    assert.strictEqual(guidedKimiDoctor.summary.errorCount, 0);
    assert.strictEqual(guidedKimiDoctor.summary.warningCount, 0);

    const guidedKimiUninstall = parseJsonOutput(
      runPublicCli(['ecc', 'uninstall', '--target', 'kimi', '--json']),
      'guided Kimi uninstall'
    );
    assert.strictEqual(guidedKimiUninstall.summary.errorCount, 0);
    assert.ok(!fs.existsSync(guidedKimiStatePath), 'guided Kimi uninstall left install-state');
    for (const entry of guidedKimiManagedSnapshot) {
      assert.ok(!fs.existsSync(entry.path), `guided Kimi uninstall left managed path: ${entry.path}`);
    }
    assert.strictEqual(
      fs.readFileSync(guidedKimiSentinel, 'utf8'),
      'keep this Kimi user file\n',
      'guided Kimi uninstall must preserve user-owned files'
    );

    const itoInstallArgs = [
      'install',
      '--profile', 'core',
      '--with', 'capability:ito-compute',
      '--with', 'capability:prediction-markets',
      '--target', 'cursor',
      '--enable-hooks',
      '--json',
    ];
    parseJsonOutput(
      runCli(itoInstallArgs),
      'initial Itô install'
    );
    assert.ok(fs.existsSync(statePath), 'initial install must write Cursor install-state');
    const initialState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const initialLedger = getOperationLedger(initialState);
    assert.ok(
      initialState.operations.some(operation => operation.moduleId === 'ito-compute'),
      'installed ledger must include the Itô compute module'
    );
    assert.ok(
      initialState.operations.some(operation => operation.moduleId === 'prediction-market-skills'),
      'installed ledger must include the Itô baskets module'
    );
    for (const relativePath of [
      'skills/ito-baskets/SKILL.md',
      'skills/ito-baskets/agents/openai.yaml',
      'skills/ito-baskets/scripts/ito-baskets.js',
      'skills/ito-compute/SKILL.md',
      'skills/ito-compute/agents/openai.yaml',
      'skills/ito-inference/SKILL.md',
      'skills/ito-training/SKILL.md',
    ]) {
      const installedPath = path.join(cursorRoot, relativePath);
      const installedStat = fs.lstatSync(installedPath);
      assert.ok(installedStat.isFile(), `packed Itô asset is not a file: ${relativePath}`);
      assert.ok(!installedStat.isSymbolicLink(), `packed Itô asset is a symlink: ${relativePath}`);
      assert.ok(installedStat.size > 0, `packed Itô asset is empty: ${relativePath}`);
    }
    const hostileBin = path.join(tempRoot, 'hostile-bin');
    const hostileItoSentinel = path.join(tempRoot, 'hostile-ito-spawned');
    fs.mkdirSync(hostileBin, { recursive: true });
    const hostileIto = path.join(hostileBin, process.platform === 'win32' ? 'ito.cmd' : 'ito');
    if (process.platform === 'win32') {
      fs.writeFileSync(hostileIto, `@echo hostile>"${hostileItoSentinel}"\r\n`, 'utf8');
    } else {
      fs.writeFileSync(hostileIto, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(hostileItoSentinel)}, 'spawned');\n`, 'utf8');
      fs.chmodSync(hostileIto, 0o755);
    }
    const itoStatus = runCli(['ito', 'status'], {
      expectedStatus: 1,
      env: {
        ...environment,
        PATH: `${hostileBin}${path.delimiter}${environment.PATH || environment.Path || ''}`,
        ITO_API_KEY: 'must-not-reach-hostile-path',
      },
    });
    assert.match(itoStatus.stderr, /canonical ito-compute-cli is unpublished/i);
    assert.doesNotMatch(itoStatus.stderr, /npx|npm exec|npm link|install -g/i);
    assert.ok(!fs.existsSync(hostileItoSentinel), 'packed Itô bridge executed a PATH collision');
    const managedSnapshot = getManagedOperationSnapshot(initialState, cursorRoot);
    assert.ok(managedSnapshot.length > 0, 'initial install must create managed Cursor files');

    parseJsonOutput(
      runCli(itoInstallArgs),
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

    const antigravityRoot = path.join(projectDir, '.agents');
    runTargetSmoke({
      runCli,
      target: 'antigravity',
      targetRoot: antigravityRoot,
    });
    assert.ok(!fs.existsSync(path.join(projectDir, '.agent')));

    const opencodeRoot = path.join(homeDir, '.config', 'opencode');
    runTargetSmoke({
      runCli,
      target: 'opencode',
      targetRoot: opencodeRoot,
    });
    assert.ok(!fs.existsSync(path.join(homeDir, '.opencode')));

    return {
      packageSha256: options.expectedSha256,
      platform: process.platform,
      node: process.version,
      lifecycle: [
        'npm-install',
        'public-ecc-universal-setup',
        'claude-setup-dry-run-isolated',
        'claude-setup-git-preflight',
        'claude-setup-install',
        'claude-setup-update',
        'guided-kimi-dry-run',
        'guided-kimi-install',
        'guided-kimi-repeat-install',
        'guided-kimi-doctor',
        'guided-kimi-uninstall',
        'guided-kimi-sentinel-preserved',
        'cursor-ito-install',
        'public-ecc-ito-fail-closed',
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
        'antigravity-install-doctor-uninstall',
        'opencode-install-doctor-uninstall',
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
