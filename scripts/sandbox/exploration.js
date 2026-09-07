'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadManifest } = require('./contracts');
const { appendEvent, clearResource, readRun, writeResource } = require('./session-store');
const { buildCreateArgs, normalizeImageId, podmanInfoIsRootless, DEFAULT_IMAGE } = require('./backends/podman');

const MIN_INTERACTIVE_TIMEOUT_MS = 30 * 60 * 1000;

function interactiveTimeoutMs(manifest) {
  return Math.max(MIN_INTERACTIVE_TIMEOUT_MS, manifest.resources.timeout * 1000);
}

function runInteractive(executable, argv, options) {
  const run = options.run || defaultRun;
  if (options.run && !options.interactive) return run(executable, argv, options);
  if (options.interactive) return options.interactive(executable, argv, options);
  return run(process.execPath, [
    path.join(__dirname, 'interactive-exec.js'),
    options.runId, options.root, 'exploration', '--', executable, ...argv,
  ], options);
}

function explorationName(backend) {
  return `ecc-explore-${backend}-${crypto.randomBytes(12).toString('hex')}`;
}

function defaultRun(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    encoding: 'utf8', shell: false, windowsHide: true,
    timeout: options.timeout || 300_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
}

function requireSuccess(result, message) {
  if (result.error || result.status !== 0) {
    throw new Error(`${message}: ${String(result.stderr || result.stdout || result.error?.message || '').trim()}`);
  }
  return result;
}

function runPodmanExploration(manifest, options) {
  const run = options.run || defaultRun;
  const cwd = path.resolve(options.cwd || process.cwd());
  const name = options.name || explorationName('podman');
  const image = options.image || DEFAULT_IMAGE;
  const info = run('podman', ['info', '--format', 'json'], { cwd });
  if (!podmanInfoIsRootless(info)) throw new Error('Podman exploration requires a running rootless Podman machine');
  const inspected = requireSuccess(
    run('podman', ['image', 'inspect', '--format', '{{.Id}}', image], { cwd }),
    `Podman image ${image} is unavailable`
  );
  const imageId = normalizeImageId(inspected.stdout);
  if (!imageId) throw new Error(`Podman image ${image} returned an invalid immutable ID`);
  const createArgs = buildCreateArgs(manifest, {
    containerName: name, cwd, image: imageId,
    runId: options.runId, ownerToken: options.ownerToken,
  });
  createArgs.splice(createArgs.length - 3, 0, '--label', 'io.ecc.sandbox.exploration=true');
  let created = false;
  try {
    const create = requireSuccess(run('podman', createArgs, { cwd }), 'Podman exploration create failed');
    created = true;
    let id = String(create.stdout || '').trim().split(/\r?\n/, 1)[0];
    if (!/^[a-f0-9]{64}$/i.test(id)) {
      id = String(requireSuccess(
        run('podman', ['inspect', '--format', '{{.Id}}', name], { cwd }),
        'Podman exploration identity lookup failed'
      ).stdout || '').trim();
    }
    if (!/^[a-f0-9]{64}$/i.test(id)) throw new Error('Podman exploration did not return an immutable container ID');
    options.registerResource?.({ kind: 'podman', name, id });
    options.emit?.({ type: 'resource.registered', phase: 'provision', resource_kind: 'podman', resource_name: name });
    requireSuccess(run('podman', ['start', id], { cwd }), 'Podman exploration start failed');
    process.stdout.write('EXPLORATION REPLICA: commands here are not verification evidence.\n');
    for (const command of manifest.steps.setup) {
      options.emit?.({ type: 'exploration.setup.started', phase: 'exploration', command });
      const setup = run('podman', ['exec', id, '/bin/bash', '-lc', command], {
        cwd, stdio: 'inherit', timeout: manifest.resources.timeout * 1000,
      });
      options.emit?.({
        type: setup.error || setup.status !== 0 ? 'exploration.setup.warning' : 'exploration.setup.completed',
        phase: 'exploration', command, exit: Number.isInteger(setup.status) ? setup.status : 2,
      });
    }
    const shell = runInteractive('podman', ['exec', '--interactive', '--tty', id, '/bin/bash'], {
      ...options, cwd, stdio: 'inherit', timeout: interactiveTimeoutMs(manifest),
    });
    return { exitCode: Number.isInteger(shell.status) ? shell.status : 2, backend: 'podman', resource: name };
  } finally {
    if (created) {
      const removed = run('podman', ['rm', '--force', '--time', '0', name], { cwd, timeout: 30_000 });
      if (!removed.error && removed.status === 0) {
        options.clearResource?.({ kind: 'podman', name });
        options.emit?.({ type: 'resource.cleared', phase: 'cleanup', resource_kind: 'podman', resource_name: name });
      }
    }
  }
}

function runExploration(runId, root, dependencies = {}) {
  const current = readRun(runId, root);
  if (
    (!current.session.exploration && current.state.status !== 'completed')
    || (current.session.exploration && current.state.status !== 'exploring')
  ) {
    throw new Error('exploration requires a completed verification run');
  }
  const manifest = loadManifest(current.session.manifest_path);
  const snapshot = fs.readFileSync(current.session.manifest_path);
  if (crypto.createHash('sha256').update(snapshot).digest('hex') !== current.session.manifest_digest) {
    throw new Error('Approved exploration manifest snapshot digest changed');
  }
  const common = {
    cwd: current.session.workspace_path || path.dirname(current.session.manifest_path),
    ownerToken: current.session.owner_token,
    runId,
    root,
    registerResource: resource => writeResource(runId, root, {
      ...resource, owner_token: current.session.owner_token,
    }),
    clearResource: selector => clearResource(
      runId, root, current.session.owner_token, selector
    ),
    emit: event => appendEvent(runId, root, event, {
      now: Date.now(),
      monotonicMs: Math.max(0, Date.now() - current.session.created_ms),
    }),
    ...dependencies,
  };
  if (current.session.route.backend === 'podman') return runPodmanExploration(manifest, common);
  throw new Error(`exploration is unavailable for ${current.session.route.backend}`);
}

module.exports = {
  explorationName,
  runExploration,
  runPodmanExploration,
};
