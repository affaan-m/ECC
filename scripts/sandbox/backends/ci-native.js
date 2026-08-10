'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { contractDigest } = require('../contracts');
const { buildSingleReport, normalizeStep } = require('../report');

const MAX_EXEC_BUFFER = 1024 * 1024;
const SENSITIVE_ENV_PATTERN = /(?:AUTH|CREDENTIAL|PASSWORD|SECRET|TOKEN)/i;
const SAFE_CI_ENV_NAMES = new Set([
  'CI',
  'COLORTERM',
  'COMSPEC',
  'DEVELOPER_DIR',
  'FORCE_COLOR',
  'GITHUB_ACTIONS',
  'GITHUB_REF',
  'GITHUB_SHA',
  'GITHUB_WORKSPACE',
  'HOME',
  'IMAGEOS',
  'IMAGEVERSION',
  'LANG',
  'NO_COLOR',
  'NUMBER_OF_PROCESSORS',
  'PATH',
  'PATHEXT',
  'RUNNER_ARCH',
  'RUNNER_OS',
  'RUNNER_TEMP',
  'RUNNER_TOOL_CACHE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'WINDIR',
]);

function defaultRunner(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    ...options,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: options.maxBuffer || MAX_EXEC_BUFFER,
  });
}

function sanitizeCiEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => (
    !SENSITIVE_ENV_PATTERN.test(name)
    && (SAFE_CI_ENV_NAMES.has(name.toUpperCase()) || name.toUpperCase().startsWith('LC_'))
  )));
}

function nativeCommand(command, platform) {
  if (platform === 'win32') {
    return {
      executable: 'powershell.exe',
      argv: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    };
  }
  return { executable: '/bin/bash', argv: ['-lc', command] };
}

function executeCiNative(manifest, options = {}) {
  const clock = options.clock || (() => Date.now());
  const startedMs = clock();
  const started = new Date(startedMs).toISOString();
  const deadline = startedMs + (manifest.resources.timeout * 1000);
  const run = options.run || defaultRunner;
  const steps = [];
  const assertions = [];
  const notes = [...(options.notes || [])];
  let executionError = false;
  const explicitlyEnabled = options.mock || (
    options.env?.GITHUB_ACTIONS === 'true'
    && options.env?.ECC_SANDBOX_CI_NATIVE === '1'
  );

  if (!explicitlyEnabled) {
    executionError = true;
    notes.push(
      'ci-native execution is restricted to the ECC sandbox matrix workflow — dispatch with an authenticated GitHub CLI: gh auth login'
    );
  } else {
    const childEnvironment = {
      ...sanitizeCiEnvironment(options.env || process.env),
      ECC_SANDBOX_TARGET_OS: options.os,
      ECC_SANDBOX_TARGET_ARCH: options.arch,
    };
    const execute = (command, assertion) => {
      const launch = nativeCommand(command, options.platform || process.platform);
      const execution = run(launch.executable, launch.argv, {
        cwd: path.resolve(options.cwd || process.cwd()),
        env: childEnvironment,
        timeout: Math.max(1, deadline - clock()),
        maxBuffer: MAX_EXEC_BUFFER,
      });
      const step = normalizeStep(command, execution);
      steps.push(step);
      if (assertion) assertions.push({ cmd: command, pass: step.exit === 0 });
      if (execution.error || execution.status === null) executionError = true;
      return step.exit === 0;
    };

    let setupPassed = true;
    for (const command of manifest.steps.setup) {
      if (!execute(command, false)) {
        setupPassed = false;
        break;
      }
    }
    if (setupPassed) {
      for (const command of manifest.steps.assert) {
        if (!execute(command, true)) break;
      }
    }
  }

  // DECISION: CONVENTIONS item 26 models the fresh hosted VM as the CI venue,
  // not as a local isolation primitive or a blank consumer machine.
  notes.push('CI-native runs on a disposable GitHub-hosted VM with preinstalled developer tools');
  notes.push('CI-native v1 enforces the manifest timeout; cpu and memory requests are advisory');
  notes.push('CI-native v1 cannot enforce per-domain or network-disabled egress');
  notes.push(`manifest_sha256=${contractDigest(manifest)}`);
  if (manifest.report === 'install-diff') {
    notes.push('CI-native v1 provides no install diff; install_diff.method is none');
  }
  if (options.mock) notes.push('Mock CI-native execution: no hosted runner command was executed');

  const report = buildSingleReport({
    manifest: options.manifestPath,
    backend: 'ci-native',
    tier: 3,
    os: options.os,
    arch: options.arch,
    executionMode: options.mock ? 'mock' : 'real',
    started,
    durationMs: clock() - startedMs,
    steps,
    assertions,
    executionError,
    notes,
  });
  return {
    report,
    exitCode: report.result === 'pass' ? 0 : (report.result === 'fail' ? 1 : 2),
  };
}

module.exports = {
  MAX_EXEC_BUFFER,
  SAFE_CI_ENV_NAMES,
  SENSITIVE_ENV_PATTERN,
  defaultRunner,
  executeCiNative,
  nativeCommand,
  sanitizeCiEnvironment,
};
