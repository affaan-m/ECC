'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildSingleReport, normalizeStep, tailOutput } = require('../report');
const { DEFAULT_IMAGE } = require('./podman');

const MICROSANDBOX_VERSION = '0.6.8';
const MAX_EXEC_BUFFER = 1024 * 1024;
const CLEANUP_TIMEOUT_MS = 30_000;

function defaultRunner(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    ...options,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: options.maxBuffer || MAX_EXEC_BUFFER,
  });
}

function succeeded(result) {
  return !result.error && result.status === 0;
}

function detail(result) {
  return tailOutput(
    [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n'),
    50,
    4_000
  );
}

function memoryForMsb(value) {
  return String(value).toUpperCase().replace(/GB$/, 'G').replace(/MB$/, 'M');
}

function networkArgs(manifest) {
  const requests = manifest.needs.capabilities.filter(value => value.startsWith('network:'));
  if (requests.length === 0) return ['--no-net'];
  if (requests.includes('network:*')) return ['--net', 'all'];
  return [
    '--no-net',
    ...requests.flatMap(value => ['--net-rule', `allow@${value.slice('network:'.length)}`]),
  ];
}

function snapshotName(image, arch) {
  const digest = crypto.createHash('sha256').update(`${image}\0${arch}`).digest('hex');
  return `ecc-${digest.slice(0, 24)}`;
}

function requestedImageDigest(image) {
  return image.match(/@(sha256:[a-f0-9]{64})$/i)?.[1].toLowerCase() || null;
}

function snapshotMatchesImage(result, image) {
  if (!succeeded(result)) return false;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const imageReference = output.match(/^Image:\s*(\S+)\s*$/mi)?.[1];
  const manifestDigest = output.match(/^Image Manifest:\s*(sha256:[a-f0-9]{64})\s*$/mi)?.[1]
    ?.toLowerCase();
  const requestedDigest = requestedImageDigest(image);
  const recordedReferenceDigest = requestedImageDigest(imageReference || '');
  return Boolean(requestedDigest)
    && manifestDigest === requestedDigest
    && (!recordedReferenceDigest || recordedReferenceDigest === requestedDigest);
}

function seedCreateArgs(manifest, options) {
  return [
    'create',
    '--name', options.seedName,
    '--cpus', String(manifest.resources.cpu),
    '--memory', memoryForMsb(manifest.resources.memory),
    '--workdir', '/workspace',
    '--user', '1000:1000',
    '--security', 'restricted',
    '--pull', 'never',
    '--no-net',
    '--quiet',
    options.image,
  ];
}

function sandboxRunArgs(manifest, options) {
  return [
    'run',
    '--name', options.sandboxName,
    '--detach',
    '--no-tty',
    '--quiet',
    '--cpus', String(manifest.resources.cpu),
    '--memory', memoryForMsb(manifest.resources.memory),
    '--mount-dir', `${path.resolve(options.cwd)}:/workspace/source:ro`,
    '--workdir', '/workspace',
    '--user', '1000:1000',
    '--security', 'restricted',
    '--max-duration', `${manifest.resources.timeout}s`,
    ...networkArgs(manifest),
    '--from-snapshot', options.snapshot,
  ];
}

function executeMicrosandbox(manifest, options = {}) {
  const run = options.run || defaultRunner;
  const cwd = path.resolve(options.cwd || process.cwd());
  const image = options.image || DEFAULT_IMAGE;
  const clock = options.clock || (() => Date.now());
  const startedMs = clock();
  const started = new Date(startedMs).toISOString();
  const deadline = startedMs + (manifest.resources.timeout * 1000);
  const sandboxName = options.sandboxName
    || `ecc-msb-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const seedName = `${sandboxName}-seed`;
  const snapshot = options.snapshot || snapshotName(image, options.arch);
  const notes = [...(options.notes || [])];
  const steps = [];
  const assertions = [];
  let startupFailure = false;
  let executionError = false;
  let sandboxCreateAttempted = false;
  let seedCreateAttempted = false;
  let cleanupSucceeded = false;
  let seedCleanupSucceeded = true;

  const invoke = (argv, timeout) => run('msb', argv, {
    cwd,
    timeout: timeout || Math.max(1, deadline - clock()),
    maxBuffer: MAX_EXEC_BUFFER,
  });
  const noteFailure = (label, result) => {
    notes.push(`${label}: ${detail(result) || 'unknown error'}`);
  };

  const version = invoke(['--version']);
  const doctor = succeeded(version) ? invoke(['doctor']) : { status: null };
  const compatible = succeeded(version)
    && new RegExp(`(?:^|\\s)${MICROSANDBOX_VERSION.replace(/\./g, '\\.')}\\b`).test(
      `${version.stdout || ''}\n${version.stderr || ''}`
    );
  if (!compatible || !succeeded(doctor)) {
    startupFailure = true;
    executionError = true;
    notes.push(
      `Microsandbox ${MICROSANDBOX_VERSION} with a passing doctor check is required — cargo install microsandbox-cli --version ${MICROSANDBOX_VERSION} --locked`
    );
    if (!compatible) noteFailure('microsandbox version check failed', version);
    if (compatible && !succeeded(doctor)) noteFailure('microsandbox doctor failed', doctor);
  }

  const imageDigest = requestedImageDigest(image);
  if (!startupFailure && !imageDigest) {
    startupFailure = true;
    executionError = true;
    notes.push(
      'Microsandbox requires ECC_SANDBOX_IMAGE to be an OCI digest reference ending in @sha256:<64 hex>'
    );
  }

  // DECISION: conventions items 11 and 23 use one integrity-checked disk
  // snapshot whose recorded image identity matches the requested digest.
  let snapshotReady = false;
  if (!startupFailure) {
    const snapshotInspect = invoke(['snapshot', 'inspect', snapshot, '--verify']);
    snapshotReady = snapshotMatchesImage(snapshotInspect, image);
    if (succeeded(snapshotInspect) && !snapshotReady) {
      startupFailure = true;
      executionError = true;
      notes.push(
        `Microsandbox snapshot ${snapshot} does not match requested image digest ${imageDigest}`
      );
    }
  }
  if (!snapshotReady) {
    if (startupFailure) {
      // The CLI preflight failed; do not invoke any mutating subcommands.
    } else {
      seedCreateAttempted = true;
      const pull = invoke(['pull', image]);
      const seedCreate = succeeded(pull)
        ? invoke(seedCreateArgs(manifest, { image, seedName }))
        : pull;
      if (succeeded(seedCreate)) {
        const seedStop = invoke(
          ['stop', '--force', '--quiet', seedName],
          CLEANUP_TIMEOUT_MS
        );
        if (succeeded(seedStop)) {
          const snapshotCreate = invoke([
            'snapshot', 'create', snapshot,
            '--from', seedName,
            '--integrity',
            '--quiet',
          ], CLEANUP_TIMEOUT_MS);
          // Always re-open the artifact and confirm integrity plus image
          // identity. A failed create may mean a concurrent run won the race.
          const createdInspect = invoke([
            'snapshot', 'inspect', snapshot, '--verify',
          ], CLEANUP_TIMEOUT_MS);
          snapshotReady = snapshotMatchesImage(createdInspect, image);
          if (!snapshotReady) {
            noteFailure('microsandbox snapshot create failed', snapshotCreate);
            noteFailure('microsandbox created snapshot verification failed', createdInspect);
          }
        } else {
          noteFailure('microsandbox seed stop failed', seedStop);
        }
      } else {
        noteFailure('microsandbox seed create failed', seedCreate);
      }

      const seedCleanup = invoke(
        ['remove', '--force', '--quiet', seedName],
        CLEANUP_TIMEOUT_MS
      );
      seedCleanupSucceeded = succeeded(seedCleanup)
        || /not found|does not exist/i.test(detail(seedCleanup));
      if (!seedCleanupSucceeded) {
        executionError = true;
        noteFailure('microsandbox seed cleanup failed', seedCleanup);
      }
    }
  }

  if (!snapshotReady) {
    startupFailure = true;
    executionError = true;
  } else {
    notes.push(`microsandbox_version=${MICROSANDBOX_VERSION}`);
    notes.push(`snapshot=${snapshot}`);
    notes.push(`snapshot_seed_image=${image}`);
    sandboxCreateAttempted = true;
    const sandboxCreate = invoke(sandboxRunArgs(manifest, {
      cwd,
      sandboxName,
      snapshot,
    }));
    if (!succeeded(sandboxCreate)) {
      startupFailure = true;
      executionError = true;
      noteFailure('microsandbox snapshot fork failed', sandboxCreate);
    } else {
      const execute = (command, assertion) => {
        const remainingSeconds = Math.max(1, Math.ceil((deadline - clock()) / 1000));
        const execution = invoke([
          'exec', sandboxName,
          '--quiet',
          '--stream',
          '--no-tty',
          '--timeout', `${remainingSeconds}s`,
          '--user', '1000:1000',
          '--workdir', '/workspace',
          '--', '/bin/bash', '-lc', command,
        ]);
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
  }

  if (sandboxCreateAttempted) {
    const cleanup = invoke(
      ['remove', '--force', '--quiet', sandboxName],
      CLEANUP_TIMEOUT_MS
    );
    cleanupSucceeded = succeeded(cleanup)
      || /not found|does not exist/i.test(detail(cleanup));
    if (!cleanupSucceeded) {
      executionError = true;
      notes.push(
        `microsandbox cleanup failed for ${sandboxName} — remove it manually: msb remove --force ${sandboxName}`
      );
    }
  }
  if (manifest.report === 'install-diff') {
    notes.push(
      `Microsandbox v${MICROSANDBOX_VERSION} exposes no filesystem diff API; install_diff.method is none`
    );
  }
  if (options.mock) notes.push('Mock Microsandbox execution: no microVM or snapshot was created');

  const report = buildSingleReport({
    manifest: options.manifestPath,
    backend: 'microsandbox',
    tier: 1,
    os: 'linux',
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
    startupFailure,
    cleanup: {
      attempted: sandboxCreateAttempted,
      pass: cleanupSucceeded,
      sandbox: sandboxName,
      seed_attempted: seedCreateAttempted,
      seed_pass: seedCleanupSucceeded,
      safe_for_fallback: (!sandboxCreateAttempted || cleanupSucceeded)
        && (!seedCreateAttempted || seedCleanupSucceeded),
    },
  };
}

module.exports = {
  CLEANUP_TIMEOUT_MS,
  MICROSANDBOX_VERSION,
  defaultRunner,
  executeMicrosandbox,
  memoryForMsb,
  networkArgs,
  requestedImageDigest,
  sandboxRunArgs,
  seedCreateArgs,
  snapshotName,
  snapshotMatchesImage,
};
