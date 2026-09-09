#!/usr/bin/env node

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');

const DEFAULT_TERMINAL = 'wezterm';
const TERMINAL_APP = 'terminal.app';
const TERMINAL_WRAPPER_TOKEN = '__ECC_TERMINAL_WRAPPER__';
const SPAWN_KILL_SIGNAL = 'SIGTERM';
const SYNC_TIMEOUT_MS = 10_000;
const TERMINAL_ALIASES = new Map([
  [DEFAULT_TERMINAL, DEFAULT_TERMINAL],
  ['terminal', TERMINAL_APP],
  ['terminal.app', TERMINAL_APP],
  ['macos-terminal', TERMINAL_APP],
]);
const SUPPORTED_TERMINALS = new Set([DEFAULT_TERMINAL, TERMINAL_APP]);
const TERMINAL_APP_LAUNCH_SCRIPT = Object.freeze([
  '-e', 'on run argv',
  '-e', 'set launcherPath to item 1 of argv',
  '-e', 'tell application "Terminal"',
  '-e', 'activate',
  '-e', 'do script (quoted form of launcherPath)',
  '-e', 'end tell',
  '-e', 'end run',
]);
const MAX_FILTERED_ENVIRONMENT_BYTES = 256 * 1024;
const MAX_FILTERED_ENVIRONMENT_ENTRIES = 128;
const FILTERED_ENVIRONMENT_PREFIX = 'ecc-terminal-env-';
const TERMINAL_APP_PREFIX = 'ecc-terminal-app-';
const TEMPORARY_LAUNCH_TTL_MS = 2 * 60 * 1000;
const TEMPORARY_CLEANUP_POLL_MS = 250;
const TEMPORARY_LAUNCH_FILES = new Map([
  [FILTERED_ENVIRONMENT_PREFIX, 'environment.json'],
  [TERMINAL_APP_PREFIX, 'launch.command'],
]);

function usage() {
  return `Open an executable and its argument array in a visible terminal.

Usage:
  node skills/terminal-opener/scripts/open-terminal.js [options] -- <executable> [args...]
  node skills/terminal-opener/scripts/open-terminal.js --detect [--terminal <name>] [--json]

Options:
  --terminal <name>  Terminal adapter: wezterm or terminal.app (default: ECC_TERMINAL or wezterm).
  --cwd <path>       Initial host directory (default: current directory).
  --recover          Start a standalone terminal with stock configuration.
  --standalone       Alias for --recover.
  --filtered-env     Inherit no environment variables unless allowed explicitly.
  --allow-env <name> Allow one existing variable in filtered mode; repeatable.
  --detect           Check whether the selected terminal can be launched.
  --launch           Explicitly open the terminal (the default only prints a plan).
  --dry-run          Explicitly print the launch plan without opening a terminal.
  --json             Emit the plan, capability, or launch result as JSON.
  --help, -h         Show this help.

Always pass the executable and arguments as separate entries after --.
Shell command strings are not accepted.
`;
}

function isAbsolutePath(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function validateTerminalName(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    throw new Error('Invalid terminal name; use a simple adapter name such as wezterm.');
  }
}

function normalizeTerminalName(value) {
  validateTerminalName(value);
  return TERMINAL_ALIASES.get(String(value).toLowerCase()) || value;
}

function validateCwd(value) {
  if (value.includes('\0')) throw new Error('--cwd must not contain a NUL byte.');
  if (!isAbsolutePath(value)) throw new Error('--cwd must be an absolute path.');
}

function validateExecutable(value) {
  if (!value || /[\0\r\n]/.test(value)) {
    throw new Error('Executable must be a non-empty argv entry without control bytes.');
  }

  const whitespaceIndex = value.search(/\s/);
  const separatorIndexes = [value.indexOf('/'), value.indexOf('\\')].filter(index => index >= 0);
  const firstSeparatorIndex = separatorIndexes.length > 0 ? Math.min(...separatorIndexes) : -1;
  const resemblesExecutablePath = isAbsolutePath(value)
    || (firstSeparatorIndex >= 0 && (whitespaceIndex < 0 || firstSeparatorIndex < whitespaceIndex));

  if (whitespaceIndex >= 0 && !resemblesExecutablePath) {
    throw new Error(
      'Executable must be one argv entry, not an interpolated shell command string.'
    );
  }
  if (!resemblesExecutablePath && /[;&|<>`$]/.test(value)) {
    throw new Error(
      'Executable must be one argv entry, not an interpolated shell command string.'
    );
  }
  if (value.startsWith('-')) {
    throw new Error('Executable must not begin with a hyphen; use an explicit path instead.');
  }
}

function validateArgv(argv) {
  for (const argument of argv) {
    if (argument.includes('\0')) throw new Error('Arguments must not contain NUL bytes.');
  }
}

function validateEnvironmentName(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error('Invalid environment variable name; use letters, digits, and underscores.');
  }
}

function normalizeEnvironment(environment = {}) {
  const mode = environment.mode || 'inherit';
  if (!['inherit', 'filtered'].includes(mode)) {
    throw new Error('Environment mode must be "inherit" or "filtered".');
  }
  const allowlist = environment.allowlist || [];
  if (!Array.isArray(allowlist)) throw new Error('Environment allowlist must be an array.');
  for (const name of allowlist) validateEnvironmentName(name);
  return { mode, allowlist: [...new Set(allowlist)] };
}

function buildSpawnEnvironment(environment, sourceEnv = process.env) {
  const policy = normalizeEnvironment(environment);
  if (policy.mode === 'inherit') return undefined;
  return Object.fromEntries(policy.allowlist.flatMap(name => (
    Object.prototype.hasOwnProperty.call(sourceEnv, name) && sourceEnv[name] !== undefined
      ? [[name, String(sourceEnv[name])]]
      : []
  )));
}

function buildOuterProcessEnvironment(plan, spawnEnvironment) {
  if (plan.terminal === TERMINAL_APP && spawnEnvironment !== undefined) return {};
  return spawnEnvironment;
}

function decodeSpawnEnvironment(payload) {
  if (
    typeof payload !== 'string'
    || payload.length === 0
    || payload.length > Math.ceil(MAX_FILTERED_ENVIRONMENT_BYTES * 4 / 3)
    || !/^[A-Za-z0-9_-]+$/.test(payload)
  ) {
    throw new Error('Invalid filtered environment payload.');
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid filtered environment payload.');
  }
  return validateDecodedEnvironment(parsed);
}

function validateDecodedEnvironment(parsed) {
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Filtered environment payload must be an object.');
  }
  const entries = Object.entries(parsed);
  if (entries.length > MAX_FILTERED_ENVIRONMENT_ENTRIES) {
    throw new Error('Filtered environment exceeds the 128-variable launch limit.');
  }
  for (const [name, value] of entries) {
    validateEnvironmentName(name);
    if (typeof value !== 'string' || value.includes('\0')) {
      throw new Error('Filtered environment values must be strings without NUL bytes.');
    }
  }
  return Object.fromEntries(entries);
}

function buildFilteredTargetArgs(plan, environmentPath, temporaryRoot = os.tmpdir()) {
  const targetArgs = [plan.executable, ...plan.argv];
  return [
    process.execPath,
    __filename,
    '--run-filtered-file',
    environmentPath,
    '--temp-root',
    temporaryRoot,
    '--',
    ...targetArgs,
  ];
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildTerminalAppScript(plan, targetArgs = [plan.executable, ...plan.argv]) {
  const commandArgs = targetArgs.map(shellQuote).join(' ');
  return [
    '#!/bin/sh',
    'wrapper_path=$0',
    'rm -f "$wrapper_path"',
    'rmdir "$(dirname "$wrapper_path")" 2>/dev/null || true',
    `cd ${shellQuote(plan.cwd)} || exit $?`,
    `exec ${commandArgs}`,
    '',
  ].join('\n');
}

function removeTerminalAppLauncher(temporaryRoot, fsImpl) {
  try {
    fsImpl.rmSync(temporaryRoot, { recursive: true, force: true });
  } catch {
    // Cleanup is best effort after the launcher has already failed.
  }
}

function validateTemporaryLaunchRoot(temporaryRoot, dependencies = {}) {
  const fsImpl = dependencies.fs || fs;
  const resolved = path.resolve(String(temporaryRoot || ''));
  if (!fsImpl.existsSync(resolved)) return null;
  const basename = path.basename(resolved);
  const entry = [...TEMPORARY_LAUNCH_FILES.entries()].find(([prefix]) => (
    basename.startsWith(prefix)
  ));
  const realpath = fsImpl.realpathSync.native || fsImpl.realpathSync;
  const stat = fsImpl.lstatSync(resolved);
  const ownerMatches = typeof process.getuid !== 'function' || stat.uid === process.getuid();
  if (
    !entry
    || realpath(path.dirname(resolved)) !== realpath(dependencies.temporaryRoot || os.tmpdir())
    || !stat.isDirectory()
    || stat.isSymbolicLink()
    || (stat.mode & 0o077) !== 0
    || !ownerMatches
    || fsImpl.readdirSync(resolved).some(name => name !== entry[1])
  ) {
    throw new Error('Temporary terminal launch directory failed private-directory validation.');
  }
  return resolved;
}

function cleanupTemporaryLaunchRoot(temporaryRoot, dependencies = {}) {
  const fsImpl = dependencies.fs || fs;
  const validated = validateTemporaryLaunchRoot(temporaryRoot, dependencies);
  if (validated) removeTerminalAppLauncher(validated, fsImpl);
}

function watchTemporaryLaunchRoot(temporaryRoot, delayMs, dependencies = {}) {
  const fsImpl = dependencies.fs || fs;
  const now = dependencies.now || Date.now;
  const setIntervalImpl = dependencies.setInterval || setInterval;
  const clearIntervalImpl = dependencies.clearInterval || clearInterval;
  const boundedDelay = Number.isSafeInteger(delayMs) && delayMs >= 0
    ? Math.min(delayMs, TEMPORARY_LAUNCH_TTL_MS)
    : TEMPORARY_LAUNCH_TTL_MS;
  const expiresAt = now() + boundedDelay;
  let timer;
  const inspect = () => {
    if (!fsImpl.existsSync(temporaryRoot)) {
      if (timer) clearIntervalImpl(timer);
      return;
    }
    if (now() >= expiresAt) {
      cleanupTemporaryLaunchRoot(temporaryRoot, dependencies);
      if (timer) clearIntervalImpl(timer);
    }
  };
  if (boundedDelay === 0) {
    inspect();
    return;
  }
  timer = setIntervalImpl(inspect, Math.min(TEMPORARY_CLEANUP_POLL_MS, boundedDelay));
}

function scheduleTemporaryCleanup(temporaryRoots, dependencies = {}) {
  const roots = [...new Set(temporaryRoots.filter(Boolean))];
  if (roots.length === 0) return;
  if (dependencies.scheduleCleanup) {
    dependencies.scheduleCleanup([...roots]);
    return;
  }
  const spawnCleanup = dependencies.spawnCleanup || childProcess.spawn;
  for (const temporaryRoot of roots) {
    const child = spawnCleanup(process.execPath, [
      __filename,
      '--cleanup-temp-root',
      temporaryRoot,
      '--temp-root',
      os.tmpdir(),
      '--after',
      String(TEMPORARY_LAUNCH_TTL_MS),
    ], {
      detached: true,
      env: {},
      shell: false,
      stdio: 'ignore',
    });
    child?.once?.('error', () => cleanupTemporaryLaunchRoot(temporaryRoot));
    child?.unref?.();
  }
}

function materializeFilteredEnvironment(environment, dependencies = {}) {
  const fsImpl = dependencies.fs || fs;
  const mkdtempSync = dependencies.mkdtempSync
    || fsImpl.mkdtempSync?.bind(fsImpl)
    || fs.mkdtempSync;
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), FILTERED_ENVIRONMENT_PREFIX));
  const environmentPath = path.join(temporaryRoot, 'environment.json');
  const serialized = JSON.stringify(environment);
  try {
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILTERED_ENVIRONMENT_BYTES) {
      throw new Error('Filtered environment exceeds the 256 KiB launch limit.');
    }
    fsImpl.chmodSync(temporaryRoot, 0o700);
    fsImpl.writeFileSync(environmentPath, serialized, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    fsImpl.chmodSync(environmentPath, 0o600);
  } catch (error) {
    removeTerminalAppLauncher(temporaryRoot, fsImpl);
    throw error;
  }
  return {
    path: environmentPath,
    root: temporaryRoot,
    temporaryBase: path.dirname(temporaryRoot),
    cleanup: () => removeTerminalAppLauncher(temporaryRoot, fsImpl),
  };
}

function readFilteredEnvironmentFile(environmentPath, dependencies = {}) {
  const fsImpl = dependencies.fs || fs;
  const resolved = path.resolve(environmentPath);
  const directory = path.dirname(resolved);
  const realpath = fsImpl.realpathSync.native || fsImpl.realpathSync;
  const temporaryRoot = realpath(dependencies.temporaryRoot || os.tmpdir());
  const canonicalParent = realpath(path.dirname(directory));
  const directoryStat = fsImpl.lstatSync(directory);
  const fileStat = fsImpl.lstatSync(resolved);
  const ownerMatches = typeof process.getuid !== 'function'
    || (directoryStat.uid === process.getuid() && fileStat.uid === process.getuid());
  if (
    canonicalParent !== temporaryRoot
    || !path.basename(directory).startsWith(FILTERED_ENVIRONMENT_PREFIX)
    || path.basename(resolved) !== 'environment.json'
    || !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || (directoryStat.mode & 0o077) !== 0
    || !fileStat.isFile()
    || fileStat.isSymbolicLink()
    || fileStat.nlink !== 1
    || (fileStat.mode & 0o077) !== 0
    || fileStat.size > MAX_FILTERED_ENVIRONMENT_BYTES
    || !ownerMatches
  ) {
    throw new Error('Filtered environment file failed private-file validation.');
  }
  let descriptor;
  let content;
  try {
    descriptor = fsImpl.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    );
    const openedStat = fsImpl.fstatSync(descriptor);
    if (
      openedStat.dev !== fileStat.dev
      || openedStat.ino !== fileStat.ino
      || openedStat.nlink !== 1
      || openedStat.size !== fileStat.size
      || !openedStat.isFile()
      || (openedStat.mode & 0o077) !== 0
      || openedStat.size > MAX_FILTERED_ENVIRONMENT_BYTES
      || (typeof process.getuid === 'function' && openedStat.uid !== process.getuid())
    ) {
      throw new Error('Filtered environment file changed during validation.');
    }
    content = fsImpl.readFileSync(descriptor, 'utf8');
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
    removeTerminalAppLauncher(directory, fsImpl);
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Filtered environment file is invalid JSON.');
  }
  return validateDecodedEnvironment(parsed);
}

function materializeTerminalAppLaunch(plan, spawnEnvironment, dependencies = {}) {
  if (!Array.isArray(plan.args)) {
    throw new Error('Terminal.app launch plan args must be an array.');
  }
  const wrapperTokens = plan.args.filter(argument => argument === TERMINAL_WRAPPER_TOKEN);
  if (wrapperTokens.length !== 1) {
    throw new Error('Terminal.app launch plan must contain exactly one launcher token.');
  }
  validateCwd(plan.cwd);
  validateExecutable(plan.executable);
  if (!Array.isArray(plan.argv)) {
    throw new Error('Terminal.app launch plan target argv must be an array.');
  }
  validateArgv(plan.argv);

  const fsImpl = dependencies.fs || fs;
  const mkdtempSync = dependencies.mkdtempSync || fsImpl.mkdtempSync?.bind(fsImpl) || fs.mkdtempSync;
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), TERMINAL_APP_PREFIX));
  const wrapperPath = path.join(temporaryRoot, 'launch.command');
  let materializedEnvironment;
  try {
    if (spawnEnvironment !== undefined) {
      materializedEnvironment = materializeFilteredEnvironment(spawnEnvironment, dependencies);
    }
    const targetArgs = materializedEnvironment
      ? buildFilteredTargetArgs(
          plan,
          materializedEnvironment.path,
          materializedEnvironment.temporaryBase
        )
      : [plan.executable, ...plan.argv];
    fsImpl.chmodSync(temporaryRoot, 0o700);
    fsImpl.writeFileSync(wrapperPath, buildTerminalAppScript(plan, targetArgs), {
      encoding: 'utf8',
      mode: 0o700,
      flag: 'wx',
    });
    fsImpl.chmodSync(wrapperPath, 0o700);
  } catch (error) {
    materializedEnvironment?.cleanup();
    removeTerminalAppLauncher(temporaryRoot, fsImpl);
    throw error;
  }
  return {
    args: plan.args.map(argument => (
      argument === TERMINAL_WRAPPER_TOKEN ? wrapperPath : argument
    )),
    temporaryRoots: [temporaryRoot, materializedEnvironment?.root].filter(Boolean),
    cleanup: () => {
      materializedEnvironment?.cleanup();
      removeTerminalAppLauncher(temporaryRoot, fsImpl);
    },
  };
}

function materializeTerminalArgs(plan, args, environmentPath, temporaryRoot) {
  if (!environmentPath) return [...args];
  const targetArgs = [plan.executable, ...plan.argv];
  const targetStart = args.length - targetArgs.length;
  if (
    targetStart < 1
    || args[targetStart - 1] !== '--'
    || !targetArgs.every((entry, index) => args[targetStart + index] === entry)
  ) {
    throw new Error('Launch plan target argv does not match its executable contract.');
  }
  return [
    ...args.slice(0, targetStart),
    ...buildFilteredTargetArgs(plan, environmentPath, temporaryRoot),
  ];
}

function prepareTerminalArgs(plan, args, spawnEnvironment, dependencies) {
  if (spawnEnvironment === undefined) {
    return { args: [...args], temporaryRoots: [], cleanup() {} };
  }
  const materialized = materializeFilteredEnvironment(spawnEnvironment, dependencies);
  try {
    return {
      args: materializeTerminalArgs(
        plan,
        args,
        materialized.path,
        materialized.temporaryBase
      ),
      temporaryRoots: [materialized.root],
      cleanup: materialized.cleanup,
    };
  } catch (error) {
    materialized.cleanup();
    throw error;
  }
}

function runFilteredCommand(payload, commandArgv, dependencies = {}) {
  const environment = decodeSpawnEnvironment(payload);
  const [executable, ...argv] = commandArgv;
  validateExecutable(executable);
  validateArgv(argv);
  const spawnSyncImpl = dependencies.spawnSync || childProcess.spawnSync;
  const result = spawnSyncImpl(executable, argv, {
    env: environment,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`Unable to run ${executable}: ${result.error.message}`);
  return Number.isInteger(result.status) ? result.status : 1;
}

function runFilteredCommandFile(environmentPath, commandArgv, dependencies = {}) {
  const environment = readFilteredEnvironmentFile(environmentPath, dependencies);
  const [executable, ...argv] = commandArgv;
  validateExecutable(executable);
  validateArgv(argv);
  const spawnSyncImpl = dependencies.spawnSync || childProcess.spawnSync;
  const result = spawnSyncImpl(executable, argv, {
    env: environment,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`Unable to run ${executable}: ${result.error.message}`);
  return Number.isInteger(result.status) ? result.status : 1;
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function parseArgs(argv, context = {}) {
  const env = context.env || process.env;
  const initialTerminal = normalizeTerminalName(env.ECC_TERMINAL || DEFAULT_TERMINAL);
  const initialCwd = context.cwd || process.cwd();
  const options = {
    argv: [],
    cwd: initialCwd,
    detect: false,
    dryRun: true,
    executable: undefined,
    environment: { mode: 'inherit', allowlist: [] },
    help: false,
    json: false,
    mode: 'normal',
    terminal: initialTerminal,
  };
  let dryRunRequested = false;
  let launchRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      options.executable = argv[index + 1];
      options.argv = argv.slice(index + 2);
      break;
    }
    if (argument === '--terminal' || argument === '--cwd') {
      const value = readValue(argv, index, argument);
      options[argument.slice(2)] = argument === '--terminal'
        ? normalizeTerminalName(value)
        : value;
      index += 1;
    } else if (argument === '--recover' || argument === '--standalone') {
      options.mode = 'recover';
    } else if (argument === '--filtered-env') {
      options.environment = { ...options.environment, mode: 'filtered' };
    } else if (argument === '--allow-env') {
      const value = readValue(argv, index, argument);
      validateEnvironmentName(value);
      options.environment = {
        ...options.environment,
        allowlist: [...options.environment.allowlist, value],
      };
      index += 1;
    } else if (argument === '--detect') {
      options.detect = true;
    } else if (argument === '--launch') {
      launchRequested = true;
      options.dryRun = false;
    } else if (argument === '--dry-run') {
      dryRunRequested = true;
      options.dryRun = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option "${argument}"; put the executable after --.`);
    }
  }

  if (launchRequested && dryRunRequested) {
    throw new Error('--launch and --dry-run are mutually exclusive.');
  }
  if (options.environment.allowlist.length > 0 && options.environment.mode !== 'filtered') {
    throw new Error('--allow-env requires --filtered-env.');
  }

  options.terminal = normalizeTerminalName(options.terminal);
  validateCwd(options.cwd);
  if (!options.help && !options.detect && !options.executable) {
    throw new Error('An executable is required after --.');
  }
  if (options.executable) validateExecutable(options.executable);
  validateArgv(options.argv);
  options.environment = normalizeEnvironment(options.environment);
  return options;
}

function unsupportedPlan(options) {
  return {
    ok: false,
    reason: 'unsupported-terminal',
    action: `Terminal "${options.terminal}" is not supported. Rerun with --terminal wezterm or --terminal terminal.app.`,
    terminal: options.terminal,
    executable: options.executable,
    environment: normalizeEnvironment(options.environment),
    argv: [...options.argv],
    cwd: options.cwd,
    dryRun: options.dryRun,
    launchMode: options.mode === 'recover' ? 'recover' : 'mux',
    command: null,
    args: null,
    fallback: null,
    probe: null,
  };
}

function buildLaunchPlan(options) {
  const terminal = normalizeTerminalName(options.terminal);
  const normalizedOptions = { ...options, terminal };
  if (!SUPPORTED_TERMINALS.has(terminal)) return unsupportedPlan(normalizedOptions);

  const commandArgs = options.executable ? [options.executable, ...options.argv] : [];
  const recover = options.mode === 'recover';
  if (terminal === TERMINAL_APP) {
    return {
      ok: true,
      reason: null,
      action: null,
      terminal,
      executable: options.executable,
      environment: normalizeEnvironment(options.environment),
      argv: [...options.argv],
      cwd: options.cwd,
      dryRun: options.dryRun,
      launchMode: 'app',
      command: '/usr/bin/osascript',
      args: [...TERMINAL_APP_LAUNCH_SCRIPT, TERMINAL_WRAPPER_TOKEN],
      fallback: null,
      probe: { command: '/usr/bin/osascript', args: ['-e', 'id of application "Terminal"'] },
      wrapper: 'temporary-command-file',
    };
  }
  return {
    ok: true,
    reason: null,
    action: null,
    terminal,
    executable: options.executable,
    environment: normalizeEnvironment(options.environment),
    argv: [...options.argv],
    cwd: options.cwd,
    dryRun: options.dryRun,
    launchMode: recover ? 'recover' : 'mux',
    command: DEFAULT_TERMINAL,
    args: recover
      ? ['--skip-config', 'start', '--always-new-process', '--cwd', options.cwd, '--', ...commandArgs]
      : ['cli', 'spawn', '--new-window', '--cwd', options.cwd, '--', ...commandArgs],
    fallback: recover
      ? null
      : {
          command: DEFAULT_TERMINAL,
          args: ['start', '--cwd', options.cwd, '--', ...commandArgs],
        },
    probe: { command: DEFAULT_TERMINAL, args: ['--version'] },
  };
}

function unavailableCapability(plan, reason, detail) {
  const action = plan.terminal === TERMINAL_APP
    ? 'Use macOS Terminal.app on this host, or rerun with --terminal wezterm.'
    : 'Install WezTerm and ensure wezterm is on PATH, then rerun with --detect.';
  return {
    terminal: plan.terminal,
    supported: true,
    available: false,
    reason,
    detail,
    action,
  };
}

function detectTerminalCapability(plan, spawnSyncImpl = childProcess.spawnSync, context = {}) {
  if (!plan.ok) {
    return {
      terminal: plan.terminal,
      supported: false,
      available: false,
      reason: plan.reason,
      detail: null,
      action: plan.action,
    };
  }

  let result;
  try {
    const spawnEnvironment = buildSpawnEnvironment(
      plan.environment,
      context.env === undefined ? process.env : context.env
    );
    const outerEnvironment = buildOuterProcessEnvironment(plan, spawnEnvironment);
    result = spawnSyncImpl(plan.probe.command, plan.probe.args, {
      encoding: 'utf8',
      killSignal: SPAWN_KILL_SIGNAL,
      shell: false,
      timeout: SYNC_TIMEOUT_MS,
      ...(outerEnvironment === undefined ? {} : { env: outerEnvironment }),
    });
  } catch (error) {
    return unavailableCapability(plan, 'probe-failed', error.message);
  }
  if (result.error) {
    const reason = result.error.code === 'ETIMEDOUT' ? 'probe-failed' : 'not-installed';
    return unavailableCapability(plan, reason, result.error.message);
  }
  if (result.status !== 0) {
    return unavailableCapability(
      plan,
      'probe-failed',
      `Terminal version probe exited with status ${result.status}.`
    );
  }
  return {
    terminal: plan.terminal,
    supported: true,
    available: true,
    reason: null,
    detail: null,
    action: null,
    version: String(result.stdout || '').trim(),
  };
}

function reportDetachedError(error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}

function launchDetached(command, args, cwd, spawnImpl, onDetachedError, spawnEnvironment) {
  let child;
  try {
    child = spawnImpl(command, args, {
      cwd,
      detached: true,
      shell: false,
      stdio: 'ignore',
      ...(spawnEnvironment === undefined ? {} : { env: spawnEnvironment }),
    });
  } catch (error) {
    throw new Error(`Unable to start ${command}: ${error.message}`, { cause: error });
  }
  if (!child || typeof child.unref !== 'function') {
    throw new Error('Terminal process did not start correctly.');
  }
  if (typeof child.once === 'function') {
    child.once('error', error => {
      onDetachedError(
        new Error(`Unable to start ${command}: ${error.message}`, { cause: error })
      );
    });
  }
  child.unref();
}

function launch(plan, dependencies = {}) {
  const spawnSyncImpl = dependencies.spawnSync || childProcess.spawnSync;
  const spawnImpl = dependencies.spawn || childProcess.spawn;
  const onDetachedError = dependencies.onDetachedError || reportDetachedError;
  const sourceEnv = dependencies.env === undefined ? process.env : dependencies.env;
  const spawnEnvironment = buildSpawnEnvironment(plan.environment, sourceEnv);
  const capability = detectTerminalCapability(plan, spawnSyncImpl, { env: sourceEnv });
  if (!capability.available) {
    throw new Error(`${capability.reason}: ${capability.action}`);
  }

  if (plan.terminal === TERMINAL_APP) {
    const materialized = materializeTerminalAppLaunch(plan, spawnEnvironment, dependencies);
    const outerEnvironment = buildOuterProcessEnvironment(plan, spawnEnvironment);
    let result;
    try {
      result = spawnSyncImpl(plan.command, materialized.args, {
        cwd: plan.cwd,
        encoding: 'utf8',
        killSignal: SPAWN_KILL_SIGNAL,
        shell: false,
        timeout: SYNC_TIMEOUT_MS,
        ...(outerEnvironment === undefined ? {} : { env: outerEnvironment }),
      });
    } catch (error) {
      materialized.cleanup();
      throw new Error(`Unable to start Terminal.app: ${error.message}`, { cause: error });
    }
    if (result.error) {
      materialized.cleanup();
      throw new Error(`Unable to start Terminal.app: ${result.error.message}`);
    }
    if (result.status !== 0) {
      materialized.cleanup();
      throw new Error(
        `Unable to start Terminal.app: launcher exited with status ${result.status}: ${String(
          result.stderr || ''
        ).trim()}`
      );
    }
    scheduleTemporaryCleanup(materialized.temporaryRoots, dependencies);
    return { strategy: 'terminal-app', capability };
  }

  const primary = prepareTerminalArgs(plan, plan.args, spawnEnvironment, dependencies);

  if (plan.launchMode === 'recover') {
    try {
      launchDetached(
        plan.command,
        primary.args,
        plan.cwd,
        spawnImpl,
        error => { primary.cleanup(); onDetachedError(error); },
        spawnEnvironment
      );
    } catch (error) {
      primary.cleanup();
      throw error;
    }
    scheduleTemporaryCleanup(primary.temporaryRoots, dependencies);
    return { strategy: 'detached-recover', capability };
  }

  let muxResult;
  try {
    muxResult = spawnSyncImpl(plan.command, primary.args, {
      cwd: plan.cwd,
      encoding: 'utf8',
      killSignal: SPAWN_KILL_SIGNAL,
      shell: false,
      timeout: SYNC_TIMEOUT_MS,
      ...(spawnEnvironment === undefined ? {} : { env: spawnEnvironment }),
    });
  } catch (error) {
    primary.cleanup();
    throw error;
  }
  if (!muxResult.error && muxResult.status === 0) {
    scheduleTemporaryCleanup(primary.temporaryRoots, dependencies);
    return { strategy: 'mux', capability };
  }
  primary.cleanup();

  const muxFailure = muxResult.error
    ? muxResult.error.message
    : `${plan.command} cli spawn exited with status ${muxResult.status}: ${String(
        muxResult.stderr || ''
      ).trim()}`;

  const fallback = prepareTerminalArgs(
    plan, plan.fallback.args, spawnEnvironment, dependencies
  );
  try {
    launchDetached(
      plan.fallback.command,
      fallback.args,
      plan.cwd,
      spawnImpl,
      error => { fallback.cleanup(); onDetachedError(error); },
      spawnEnvironment
    );
  } catch (error) {
    fallback.cleanup();
    throw error;
  }
  scheduleTemporaryCleanup(fallback.temporaryRoots, dependencies);
  return { strategy: 'detached-fallback', capability, muxFailure };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatLaunchResult(plan, result, json) {
  if (json) {
    return `${JSON.stringify({ ...plan, ...result }, null, 2)}\n`;
  }

  const summary =
    `Open ${plan.executable} in ${plan.terminal} using ${plan.launchMode} mode.\n`;
  if (result.strategy !== 'detached-fallback') return summary;
  return `${summary}Mux launch failed: ${result.muxFailure}\n`;
}

function printPlan(plan, json) {
  if (json) return printJson(plan);
  if (!plan.ok) {
    process.stdout.write(`${plan.action}\n`);
    return;
  }
  process.stdout.write(
    `Open ${plan.executable} in ${plan.terminal} using ${plan.launchMode} mode.\n`
  );
}

function printCapability(capability, json) {
  if (json) return printJson(capability);
  if (capability.available) {
    process.stdout.write(`${capability.terminal} is available (${capability.version}).\n`);
  } else {
    process.stdout.write(`${capability.terminal} is unavailable. ${capability.action}\n`);
  }
}

function main() {
  try {
    const argv = process.argv.slice(2);
    if (argv[0] === '--cleanup-temp-root') {
      if (
        argv[2] !== '--temp-root'
        || !argv[3]
        || argv[4] !== '--after'
        || argv.length !== 6
        || !/^\d+$/.test(argv[5])
      ) {
        throw new Error('Temporary launch cleanup requires a root and bounded delay.');
      }
      watchTemporaryLaunchRoot(argv[1], Number(argv[5]), { temporaryRoot: argv[3] });
      return;
    }
    if (argv[0] === '--run-filtered-file') {
      const boundary = argv.indexOf('--', 4);
      if (
        !argv[1]
        || argv[2] !== '--temp-root'
        || !argv[3]
        || boundary < 0
        || boundary === argv.length - 1
      ) {
        throw new Error('Filtered launch requires a private environment file and executable argv.');
      }
      process.exitCode = runFilteredCommandFile(argv[1], argv.slice(boundary + 1), {
        temporaryRoot: argv[3],
      });
      return;
    }
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(usage());
      return;
    }

    const plan = buildLaunchPlan(options);
    if (options.detect) {
      const capability = detectTerminalCapability(plan);
      printCapability(capability, options.json);
      if (!capability.available) process.exitCode = 1;
      return;
    }

    if (options.dryRun) {
      printPlan(plan, options.json);
      return;
    }
    const result = launch(plan);
    process.stdout.write(formatLaunchResult(plan, result, options.json));
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildLaunchPlan,
  buildSpawnEnvironment,
  buildTerminalAppScript,
  cleanupTemporaryLaunchRoot,
  detectTerminalCapability,
  formatLaunchResult,
  launch,
  parseArgs,
  runFilteredCommand,
  runFilteredCommandFile,
  scheduleTemporaryCleanup,
  usage,
  watchTemporaryLaunchRoot,
};
