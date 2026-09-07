'use strict';

const path = require('path');
const {
  buildLaunchPlan,
  launch,
} = require('../../skills/terminal-opener/scripts/open-terminal');
const { readRun } = require('./session-store');

function filteredSupervisorEnvironment(source = process.env) {
  const allowed = new Set([
    'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'TERM', 'COLORTERM', 'XDG_RUNTIME_DIR',
    'ECC_SANDBOX_IMAGE', 'ECC_SANDBOX_LUME_SEED', 'ECC_SANDBOX_LIMA_SEED',
    'ECC_SANDBOX_TART_SEED', 'ECC_SANDBOX_ALLOW_NESTED_SRT',
  ]);
  const environment = Object.fromEntries(Object.entries(source).filter(([name]) => (
    allowed.has(name) || name.startsWith('LC_')
  )));
  environment.PATH = [
    '/opt/podman/bin', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
    path.join(environment.HOME || '', '.local', 'bin'),
  ].filter(Boolean).join(path.delimiter);
  return environment;
}

function terminalPlan(terminal, executable, argv) {
  return buildLaunchPlan({
    terminal,
    cwd: process.cwd(),
    executable,
    argv,
    dryRun: false,
    mode: 'normal',
    environment: {
      mode: 'filtered',
      allowlist: ['PATH', 'TERM', 'LANG', 'LC_ALL', 'LC_CTYPE', 'COLORTERM'],
    },
  });
}

function runPlan(plan, dependencies = {}) {
  const result = (dependencies.launch || launch)(plan, {
    env: filteredSupervisorEnvironment(dependencies.environment || process.env),
  });
  return { plan, result };
}

function launchTerminal(runId, root, context, dependencies = {}) {
  let sessionTerminal = 'wezterm';
  try {
    sessionTerminal = readRun(runId, root).session.terminal || 'wezterm';
  } catch {
    // A dry test may inject a terminal before session persistence.
  }
  const plan = terminalPlan(
    context.terminal || sessionTerminal,
    process.execPath,
    [context.cliPath, '_ui', runId, '--state-root', root]
  );
  return runPlan(plan, dependencies);
}

function launchExploration(runId, root, context, dependencies = {}) {
  const selected = context.terminal || readRun(runId, root).session.terminal || 'wezterm';
  const plan = terminalPlan(
    selected,
    process.execPath,
    [context.cliPath, '_explore', runId, '--state-root', root]
  );
  return runPlan(plan, dependencies);
}

module.exports = {
  filteredSupervisorEnvironment,
  launchExploration,
  launchTerminal,
};
