#!/usr/bin/env node

'use strict';

const path = require('path');
const childProcess = require('child_process');

const DEFAULT_TERMINAL = 'wezterm';
const SUPPORTED_TERMINALS = new Set([DEFAULT_TERMINAL]);

function usage() {
  return `Open an executable and its argument array in a visible terminal.

Usage:
  node skills/terminal-opener/scripts/open-terminal.js [options] -- <executable> [args...]
  node skills/terminal-opener/scripts/open-terminal.js --detect [--terminal <name>] [--json]

Options:
  --terminal <name>  Terminal adapter (default: ECC_TERMINAL or wezterm).
  --cwd <path>       Initial host directory (default: current directory).
  --recover          Start a standalone terminal with stock configuration.
  --standalone       Alias for --recover.
  --detect           Check whether the selected terminal can be launched.
  --launch           Explicitly open the terminal (the default only prints a plan).
  --dry-run          Explicitly print the launch plan without opening a terminal.
  --json             Emit the plan or capability result as JSON.
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
}

function validateArgv(argv) {
  for (const argument of argv) {
    if (argument.includes('\0')) throw new Error('Arguments must not contain NUL bytes.');
  }
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
  const initialTerminal = env.ECC_TERMINAL || DEFAULT_TERMINAL;
  const initialCwd = context.cwd || process.cwd();
  const options = {
    argv: [],
    cwd: initialCwd,
    detect: false,
    dryRun: true,
    executable: undefined,
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
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === '--recover' || argument === '--standalone') {
      options.mode = 'recover';
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

  validateTerminalName(options.terminal);
  validateCwd(options.cwd);
  if (!options.help && !options.detect && !options.executable) {
    throw new Error('An executable is required after --.');
  }
  if (options.executable) validateExecutable(options.executable);
  validateArgv(options.argv);
  return options;
}

function unsupportedPlan(options) {
  return {
    ok: false,
    reason: 'unsupported-terminal',
    action: `Terminal "${options.terminal}" is not supported. Install WezTerm, then rerun with --terminal wezterm.`,
    terminal: options.terminal,
    executable: options.executable,
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
  if (!SUPPORTED_TERMINALS.has(options.terminal)) return unsupportedPlan(options);

  const commandArgs = options.executable ? [options.executable, ...options.argv] : [];
  const recover = options.mode === 'recover';
  return {
    ok: true,
    reason: null,
    action: null,
    terminal: options.terminal,
    executable: options.executable,
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
  return {
    terminal: plan.terminal,
    supported: true,
    available: false,
    reason,
    detail,
    action: 'Install WezTerm and ensure wezterm is on PATH, then rerun with --detect.',
  };
}

function detectTerminalCapability(plan, spawnSyncImpl = childProcess.spawnSync) {
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
    result = spawnSyncImpl(plan.probe.command, plan.probe.args, {
      encoding: 'utf8',
      shell: false,
    });
  } catch (error) {
    return unavailableCapability(plan, 'probe-failed', error.message);
  }
  if (result.error) {
    return unavailableCapability(plan, 'not-installed', result.error.message);
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
}

function launchDetached(command, args, cwd, spawnImpl, onDetachedError) {
  let child;
  try {
    child = spawnImpl(command, args, {
      cwd,
      detached: true,
      shell: false,
      stdio: 'ignore',
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
  const capability = detectTerminalCapability(plan, spawnSyncImpl);
  if (!capability.available) {
    throw new Error(`${capability.reason}: ${capability.action}`);
  }

  if (plan.launchMode === 'recover') {
    launchDetached(plan.command, plan.args, plan.cwd, spawnImpl, onDetachedError);
    return { strategy: 'detached-recover', capability };
  }

  const muxResult = spawnSyncImpl(plan.command, plan.args, {
    cwd: plan.cwd,
    encoding: 'utf8',
    shell: false,
  });
  if (!muxResult.error && muxResult.status === 0) {
    return { strategy: 'mux', capability };
  }

  launchDetached(
    plan.fallback.command,
    plan.fallback.args,
    plan.cwd,
    spawnImpl,
    onDetachedError
  );
  return { strategy: 'detached-fallback', capability };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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
    const options = parseArgs(process.argv.slice(2));
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

    printPlan(plan, options.json);
    if (options.dryRun) return;
    launch(plan);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildLaunchPlan,
  detectTerminalCapability,
  launch,
  parseArgs,
  usage,
};
