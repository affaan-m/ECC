'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadManifest } = require('./contracts');
const { appendEvent, clearResource, readRun, writeResource } = require('./session-store');
const { processIdentity } = require('./stream-exec');
const { buildCreateArgs, normalizeImageId, podmanInfoIsRootless, DEFAULT_IMAGE } = require('./backends/podman');
const { generateSrtSettings, sanitizeEnvironment } = require('./backends/srt');
const { DEFAULT_LUME_SEED, LUME_DRIVER, lumeSeedReady, startLume } = require('./backends/lume');
const { acquireVmRunLock, forceOwnedLauncher, stopOwnedLauncher } = require('./backends/vm');

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

function requireCleanup(condition, message) {
  if (!condition) throw new Error(message);
}

function stopViewer(viewer, sleep = milliseconds => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}, identity = null, inspectIdentity = processIdentity) {
  if (!viewer?.pid) return true;
  const alive = () => {
    try { process.kill(viewer.pid, 0); return true; } catch { return false; }
  };
  if (identity) {
    const current = inspectIdentity(viewer.pid);
    if (current && (current.started !== identity.started || current.command !== identity.command)) return false;
  }
  try { process.kill(-viewer.pid, 'SIGTERM'); } catch { return !alive(); }
  for (let attempt = 0; attempt < 20 && alive(); attempt += 1) sleep(50);
  if (!alive()) return true;
  try { process.kill(-viewer.pid, 'SIGKILL'); } catch { return !alive(); }
  for (let attempt = 0; attempt < 20 && alive(); attempt += 1) sleep(50);
  return !alive();
}

function runSrtExploration(manifest, options) {
  const run = options.run || defaultRun;
  const cwd = path.resolve(options.cwd || process.cwd());
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-explore-srt-'));
  const settingsPath = path.join(tempRoot, 'settings.json');
  try {
    const settings = generateSrtSettings(manifest, cwd, {
      ephemeralReadPaths: [tempRoot], ephemeralDenyWritePaths: [tempRoot],
    });
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write('EXPLORATION REPLICA: commands here are not verification evidence.\n');
    for (const command of manifest.steps.setup) {
      options.emit?.({ type: 'exploration.setup.started', phase: 'exploration', command });
      const setup = run('srt', ['--settings', settingsPath, '-c', command], {
        cwd, env: sanitizeEnvironment(process.env), stdio: 'inherit', timeout: manifest.resources.timeout * 1000,
      });
      options.emit?.({
        type: setup.error || setup.status !== 0 ? 'exploration.setup.warning' : 'exploration.setup.completed',
        phase: 'exploration', command, exit: Number.isInteger(setup.status) ? setup.status : 2,
      });
    }
    const shell = process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/zsh';
    const result = runInteractive('srt', ['--settings', settingsPath, '-c', `${shell} -l`], {
      ...options, cwd, env: sanitizeEnvironment(process.env), stdio: 'inherit',
      timeout: interactiveTimeoutMs(manifest),
    });
    return { exitCode: Number.isInteger(result.status) ? result.status : 2, backend: 'srt' };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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

function runLumeExploration(manifest, options) {
  const run = options.run || defaultRun;
  const start = options.start || startLume;
  const sleep = options.sleep || (milliseconds => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  });
  const cwd = path.resolve(options.cwd || process.cwd());
  const name = options.name || explorationName('lume');
  const seed = options.seed || process.env.ECC_SANDBOX_LUME_SEED || DEFAULT_LUME_SEED;
  const reservation = options.acquireLock
    ? options.acquireLock('host-local-vms') : acquireVmRunLock('lume');
  if (!reservation.pass) {
    throw new Error(`Lume exploration cannot acquire the shared host VM lifecycle lock: ${reservation.note}`);
  }
  const pinnedArgs = argv => storagePath
    ? require('./vm-storage').withLumeStorage(argv, storagePath) : argv;
  const invoke = (argv, timeout = 60_000) => run('lume', pinnedArgs(argv), { cwd, timeout });
  const succeeded = result => !result.error && result.status === 0;
  let cloneAttempted = false;
  let viewer = null;
  let failure = null;
  let outcome = null;
  let cleanupFailure = null;
  let storagePath = null;
  const helpers = new Set();
  const destinationOccupied = () => {
    try { fs.lstatSync(path.join(storagePath, name)); return true; } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  };
  const register = fields => options.registerResource?.({ kind: 'lume', name, seed, storage_path: storagePath, ...fields });
  try {
    const preflight = LUME_DRIVER.preflight(invoke, [], run);
    if (!preflight.pass) throw new Error(preflight.note);
    const seedResult = invoke(LUME_DRIVER.seedCheckArgs(seed));
    if (!succeeded(seedResult) || !lumeSeedReady(seedResult, { arch: 'arm64' })) {
      throw new Error(`Lume exploration requires the stopped seed ${seed}`);
    }
    const resolveStorage = options.vmStoragePath || require('./vm-storage').vmStoragePath;
    storagePath = resolveStorage('lume', seed, seedResult, { run, cwd });
    const assess = options.assessHostResources || require('./host-resources').assessHostResources;
    const admit = (bytes, persist = true) => {
      const admission = assess(manifest, { storagePath, cloneBytes: bytes });
      if (persist || admission?.decision !== 'allow') {
        options.emit?.({ type: 'resource.admission', phase: 'provision', admission, text: admission?.message });
      }
      if (admission?.decision !== 'allow') {
        throw new Error(`Lume exploration cannot safely launch this VM: ${admission?.message || 'Host resource headroom could not be verified; close other workloads and retry.'}`);
      }
    };
    if (destinationOccupied()) {
      throw new Error('Lume exploration destination already exists; choose a fresh replica name before retrying.');
    }
    // Helper preparation may compile a small native executable. Check memory
    // and minimum disk headroom before that work, then obtain a fresh sample
    // with the selected clone budget before provisioning.
    admit(0, false);
    const prepare = options.prepareLumeClone || require('./lume-clone').prepareLumeClone;
    const clonePlan = typeof prepare === 'function' ? prepare(
      path.join(storagePath, seed), path.join(storagePath, name), {
        run,
        verifySourceStopped: () => {
          const source = invoke(LUME_DRIVER.seedCheckArgs(seed));
          return succeeded(source) && lumeSeedReady(source, { arch: 'arm64' });
        },
      }
    ) : { supported: false, code: 'lume_cow_unavailable', message: 'Copy-on-write support is unavailable; full-copy disk budget required.' };
    const prepared = clonePlan?.supported === true;
    if (prepared && (clonePlan.cloneBytes !== 0 || typeof clonePlan.clone !== 'function')) {
      throw new Error('Lume prepared clone returned an invalid zero-copy budget contract');
    }
    const cloneBytes = prepared ? 0 : (options.vmCloneBudget || require('./vm-storage').vmCloneBudget)(
      'lume', seed, seedResult, { run, cwd, storagePath }
    );
    admit(cloneBytes);
    options.emit?.({ type: 'resource.clone.prepared', phase: 'provision',
      clone: { supported: prepared, clone_bytes: cloneBytes, code: clonePlan?.code, message: clonePlan?.message },
      text: clonePlan?.message,
    });
    const ownClone = () => {
      cloneAttempted = true;
      register({});
      options.emit?.({ type: 'resource.registered', phase: 'provision', resource_kind: 'lume', resource_name: name });
    };
    if (prepared) {
      let cloned;
      try {
        cloned = clonePlan.clone();
        if (!cloned || cloned.ok !== true || cloned.copy_method !== 'clonefile-required') {
          throw Object.assign(new Error(cloned?.message || 'Prepared copy-on-write clone failed; full-copy fallback is disabled.'), { receipt: cloned });
        }
      } catch (error) {
        const receipt = error.receipt || cloned || { ok: false, code: error.code || 'lume_cow_failed', message: error.message };
        // The native helper owns failed partial cleanup. A refusal caused by
        // an existing destination confers no ownership over that directory.
        if (receipt.owned_destination === true && receipt.cleanup_pass === false) ownClone();
        options.emit?.({ type: 'resource.clone.failed', phase: 'provision', clone: receipt, text: error.message });
        throw error;
      }
      ownClone();
      options.emit?.({ type: 'resource.clone.completed', phase: 'provision', clone: cloned, text: cloned.message });
    } else {
      if (destinationOccupied()) {
        throw new Error('Lume exploration destination already exists; choose a fresh replica name before retrying.');
      }
      const copied = invoke(LUME_DRIVER.cloneArgs(seed, name, manifest));
      if (!succeeded(copied)) {
        const message = `Lume exploration clone failed; cleanup of an unproven destination is unverified. Inspect ${path.join(storagePath, name)} before retrying.`;
        options.emit?.({ type: 'resource.clone.failed', phase: 'provision',
          clone: { ok: false, owned_destination: false, cleanup_pass: false, message }, text: message });
        requireSuccess(copied, message);
      }
      ownClone();
      options.emit?.({ type: 'resource.clone.completed', phase: 'provision',
        clone: { ok: true, copy_method: 'backend-clone', clone_bytes: cloneBytes },
        text: 'Lume backend clone completed with a conservative full-copy disk budget.',
      });
    }
    requireSuccess(invoke(LUME_DRIVER.configureArgs(name, manifest)), 'Lume exploration resource setup failed');
    const finalPreflight = LUME_DRIVER.preflight(invoke, [], run);
    if (!finalPreflight.pass) throw new Error(finalPreflight.note);
    if (resolveStorage('lume', seed, seedResult, { run, cwd }) !== storagePath) {
      throw new Error('Lume destination storage changed during provisioning; restore the approved storage configuration before retrying.');
    }
    // Both samples precede launch. The clone now occupies disk, so its copy
    // budget is charged only in the first assessment.
    admit(0);
    const launched = requireSuccess(start('lume', pinnedArgs(['run', name, '--display', 'native']), {
      ...options, cwd, sleep,
      onLauncher: launcher => register({ launcher }),
      onHelper: helper => {
        options.registerResource?.({ kind: 'lume-helper', name: String(helper.pid), ...helper });
        helpers.add(String(helper.pid));
      },
    }), 'Lume exploration launch failed');
    viewer = launched.child;
    if (!viewer?.ownershipReceipt || typeof viewer.isOwned !== 'function') {
      throw new Error('Lume exploration launcher did not provide verified ownership');
    }
    register({ launcher: viewer.ownershipReceipt });
    let ready = false;
    let stableSamples = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!viewer.isOwned()) throw new Error('Lume exploration launcher exited before guest readiness');
      if (viewer.captureDescendants?.() !== true) {
        throw new Error('Lume exploration could not inspect owned launcher descendants');
      }
      const details = invoke(LUME_DRIVER.ownershipArgs(name), 10_000);
      const marker = succeeded(details) ? LUME_DRIVER.ownershipMarker(details) : null;
      if (marker) {
        if (viewer.addOwnershipMarker?.(marker) !== true) {
          throw new Error('Lume exploration helper ownership could not be verified');
        }
        register({ launcher: viewer.ownershipReceipt, guest_marker: marker });
      }
      const probe = invoke(LUME_DRIVER.readyArgs(name), 10_000);
      stableSamples = succeeded(probe) && marker && viewer.helperBarrierReady?.() === true
        ? stableSamples + 1 : 0;
      if (stableSamples >= 2) { ready = true; break; }
      sleep(3_000);
    }
    if (!ready) throw new Error('Lume exploration guest did not become SSH-ready with verified helper ownership');
    for (const command of manifest.steps.setup) {
      options.emit?.({ type: 'exploration.setup.started', phase: 'exploration', command });
      const setup = run('lume', pinnedArgs(LUME_DRIVER.execArgs(name, command, manifest.resources.timeout)), {
        cwd, stdio: 'inherit', timeout: manifest.resources.timeout * 1000,
      });
      options.emit?.({
        type: succeeded(setup) ? 'exploration.setup.completed' : 'exploration.setup.failed',
        phase: 'exploration', command, exit: Number.isInteger(setup.status) ? setup.status : 2,
      });
      requireSuccess(setup, 'Lume exploration setup failed; the workspace is not ready');
    }
    process.stdout.write('EXPLORATION REPLICA: setup completed. Native viewer and shell output are not verification evidence.\n');
    const shell = runInteractive('lume', pinnedArgs(['ssh', name]), {
      ...options, cwd, stdio: 'inherit', timeout: interactiveTimeoutMs(manifest),
    });
    outcome = { exitCode: Number.isInteger(shell.status) ? shell.status : 2, backend: 'lume', resource: name };
  } catch (error) {
    failure = error;
  } finally {
    try {
      let launcherStopped = true;
      if (viewer) {
        launcherStopped = stopOwnedLauncher(viewer, sleep)
          || forceOwnedLauncher(viewer, sleep);
      }
      requireCleanup(launcherStopped, 'owned launcher process tree remains active');
      if (cloneAttempted) {
        invoke(LUME_DRIVER.stopArgs(name));
        const stopped = invoke(LUME_DRIVER.stoppedArgs(name));
        const absent = !stopped.error && stopped.status !== 0 && LUME_DRIVER.missingInstance(stopped);
        requireCleanup(absent || (succeeded(stopped) && LUME_DRIVER.stopped(stopped)), 'stopped state could not be verified');
        if (!absent) {
          requireSuccess(invoke(LUME_DRIVER.deleteArgs(name)), 'replica deletion failed');
          const deleted = invoke(LUME_DRIVER.stoppedArgs(name));
          requireCleanup(!deleted.error && deleted.status !== 0 && LUME_DRIVER.missingInstance(deleted), 'replica deletion could not be verified');
        }
        for (const helperName of helpers) options.clearResource?.({ kind: 'lume-helper', name: helperName });
        options.clearResource?.({ kind: 'lume', name });
        options.emit?.({ type: 'resource.cleared', phase: 'cleanup', resource_kind: 'lume', resource_name: name });
      }
    } catch (error) {
      cleanupFailure = error;
    } finally {
      reservation.release();
    }
  }
  if (cleanupFailure) {
    throw new Error(`${failure ? `${failure.message}; ` : ''}Lume exploration cleanup incomplete; resource retained: ${cleanupFailure.message}. Inspect ${name} before retrying.`);
  }
  if (failure) throw failure;
  return { ...outcome, cleanup: { pass: true, retained: false } };
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
  if (current.session.route.backend === 'srt') return runSrtExploration(manifest, common);
  if (current.session.route.backend === 'podman') return runPodmanExploration(manifest, common);
  if (current.session.route.backend === 'lume') return runLumeExploration(manifest, common);
  throw new Error(`exploration is unavailable for ${current.session.route.backend}`);
}

module.exports = {
  explorationName,
  runExploration,
  runLumeExploration,
  runPodmanExploration,
  runSrtExploration,
  stopViewer,
};
