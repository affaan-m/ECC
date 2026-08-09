'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildSingleReport, normalizeStep } = require('../report');
const { loadMockScenario, mockRunner, validateMockScenario } = require('../mock');

const SRT_DENIAL_EXIT_CODE = 77;
const MAX_EXEC_BUFFER = 1024 * 1024;
const DENIAL_PATTERN = /(?:operation not permitted|permission denied|access is denied|unauthorizedaccessexception|read-only file system|\bEPERM\b|\bEACCES\b|blocked by network allowlist|sandbox(?:ed)?[^\n]*(?:deny|denied|violation))/i;
const INSTALLER_PATTERN = /(?:^|[;&|\s])(?:apt(?:-get)?|dnf|yum|pacman|apk|brew|npm|pnpm|yarn|pip(?:3)?|gem|cargo)\s+(?:add|install|update|upgrade)|(?:^|\s)(?:systemctl|launchctl|reg(?:\.exe)?\s+add|msiexec)(?:\s|$)|(?:^|\s)(?:\/usr|\/etc|\/opt|\/Library|C:\\Program Files)[\\/]/i;
const SAFE_ENV_NAMES = new Set([
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'LANG',
  'NO_COLOR',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'WINDIR',
]);

function defaultRunner(executable, argv, options) {
  return spawnSync(executable, argv, {
    ...options,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: MAX_EXEC_BUFFER,
  });
}

function networkDomains(manifest) {
  const domains = manifest.needs.capabilities
    .filter(capability => capability.startsWith('network:'))
    .map(capability => capability.slice('network:'.length));
  if (domains.includes('*')) {
    throw new Error('SRT cannot express unrestricted network:*; route this manifest to Tier 1');
  }
  return domains;
}

function sanitizeEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => (
    SAFE_ENV_NAMES.has(name.toUpperCase()) || name.toUpperCase().startsWith('LC_')
  )));
}

function environmentValue(environment, name) {
  const match = Object.entries(environment).find(([key]) => key.toUpperCase() === name);
  return match?.[1];
}

function pathIsInsideWindows(parent, candidate) {
  const relative = path.win32.relative(path.win32.resolve(parent), path.win32.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative));
}

function resolveWindowsSrtShim(environment, cwd, fileExists = fs.existsSync) {
  const searchPath = environmentValue(environment, 'PATH');
  if (!searchPath) return null;
  for (const rawEntry of searchPath.split(path.win32.delimiter)) {
    const entry = rawEntry.replace(/^"|"$/g, '');
    // Relative and workspace-local PATH entries are controlled by the tested
    // repository, so they can never launch before the sandbox boundary.
    if (!entry || !path.win32.isAbsolute(entry) || pathIsInsideWindows(cwd, entry)) continue;
    const candidate = path.win32.join(entry, 'srt.cmd');
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function generateSrtSettings(manifest, cwd, options = {}) {
  const capabilities = manifest.needs.capabilities;
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const allowRead = [path.resolve(cwd), ...(options.ephemeralReadPaths || [])]
    .map(readPath => path.resolve(readPath));
  const denyWrite = (options.ephemeralDenyWritePaths || [])
    .map(writePath => path.resolve(writePath));
  return {
    network: {
      allowedDomains: networkDomains(manifest),
      deniedDomains: [],
      strictAllowlist: true,
      allowLocalBinding: false,
    },
    filesystem: {
      // DECISION: CONVENTIONS item 16 denies undeclared home-state reads while
      // preserving project access for ordinary developer probes.
      denyRead: [homeDir],
      allowRead,
      // DECISION: CONVENTIONS item 15 makes fs-write workspace-scoped because
      // the v1 vocabulary has no field for arbitrary host write paths.
      allowWrite: capabilities.includes('fs-write') ? [path.resolve(cwd)] : [],
      denyWrite,
    },
    enableWeakerNestedSandbox: options.enableWeakerNestedSandbox === true,
    enableWeakerNetworkIsolation: false,
  };
}

function isSrtDenial(execution) {
  const output = [
    execution.stdout,
    execution.stderr,
    execution.error?.message,
  ].filter(Boolean).join('\n');
  return execution.status !== 0 && DENIAL_PATTERN.test(output);
}

function hasInstallerSignature(command) {
  return INSTALLER_PATTERN.test(command);
}

function executeSrt(manifest, options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const platform = options.platform || process.platform;
  const clock = options.clock || (() => Date.now());
  const startedMs = clock();
  const started = new Date(startedMs).toISOString();
  const deadline = startedMs + (manifest.resources.timeout * 1000);
  const enableWeakerNestedSandbox = options.enableWeakerNestedSandbox === true;
  const tempRoot = fs.mkdtempSync(path.join(
    path.resolve(options.tempParent || os.tmpdir()),
    'ecc-srt-'
  ));
  const settings = generateSrtSettings(manifest, cwd, {
    enableWeakerNestedSandbox,
    ephemeralDenyWritePaths: [tempRoot],
    ephemeralReadPaths: [tempRoot],
  });
  const settingsPath = path.join(tempRoot, 'settings.json');
  const run = options.run || defaultRunner;
  const childEnvironment = sanitizeEnvironment(options.env || process.env);
  const windowsSrtShim = platform === 'win32'
    ? (options.srtShim || resolveWindowsSrtShim(
      options.env || process.env,
      cwd,
      options.fileExists || fs.existsSync
    ))
    : null;
  const steps = [];
  const assertions = [];
  const notes = [];
  let denial = null;
  let executionError = false;

  if (platform === 'win32' && !windowsSrtShim) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(
      'trusted srt.cmd not found outside the workspace — npm install -g @anthropic-ai/sandbox-runtime'
    );
  }

  if (manifest.report === 'install-diff') {
    notes.push('Tier 0 does not provide install-diff evidence; install_diff.method is none');
  }
  notes.push('Tier 0 enforces timeout only; cpu and memory requests are advisory');
  notes.push('Tier 0 denies reads outside the workspace within the user home and passes a minimal non-secret environment allowlist');
  if (options.mock) notes.push('Mock SRT execution: no isolation was applied');
  if (enableWeakerNestedSandbox) {
    notes.push('SRT weaker nested sandbox was explicitly enabled');
  }

  try {
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });

    const execute = (command, assertion) => {
      const remainingMs = Math.max(1, deadline - clock());
      let executable = options.executable || 'srt';
      let argv = ['--settings', settingsPath, '-c', command];
      if (platform === 'win32') {
        // DECISION: CONVENTIONS item 19 keeps repository shim lookup and
        // manifest text outside the pre-sandbox cmd.exe boundary.
        const commandPath = path.join(tempRoot, `step-${steps.length}.cmd`);
        fs.writeFileSync(commandPath, `@echo off\r\n${command}\r\n`, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
        executable = options.comspec || process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
        argv = [
          '/d',
          '/s',
          '/c',
          windowsSrtShim,
          '--settings',
          settingsPath,
          '-c',
          `call "${commandPath}"`,
        ];
      }
      const execution = run(
        executable,
        argv,
        {
          cwd,
          env: childEnvironment,
          timeout: remainingMs,
        }
      );
      const step = normalizeStep(command, execution);
      steps.push(step);
      if (assertion) assertions.push({ cmd: command, pass: step.exit === 0 });
      if (isSrtDenial(execution)) {
        denial = { command, installer: hasInstallerSignature(command) };
      }
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
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (denial) {
    notes.push(
      denial.installer
        ? 'suspected-srt-denial: installer or system-write command is eligible for one-hop escalation'
        : 'suspected-srt-denial: output matched a policy-denial heuristic; automatic escalation requires an installer command signature'
    );
  }
  const report = buildSingleReport({
    manifest: options.manifestPath,
    backend: 'srt',
    tier: 0,
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
  const exitCode = executionError
    ? 2
    : (denial ? SRT_DENIAL_EXIT_CODE : (report.result === 'pass' ? 0 : 1));
  return { report, exitCode, denial };
}

module.exports = {
  DENIAL_PATTERN,
  INSTALLER_PATTERN,
  MAX_EXEC_BUFFER,
  SAFE_ENV_NAMES,
  SRT_DENIAL_EXIT_CODE,
  defaultRunner,
  executeSrt,
  generateSrtSettings,
  hasInstallerSignature,
  isSrtDenial,
  loadMockScenario,
  mockRunner,
  networkDomains,
  resolveWindowsSrtShim,
  sanitizeEnvironment,
  validateMockScenario,
};
