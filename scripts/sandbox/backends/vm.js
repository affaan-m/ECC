'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildSingleReport,
  emptyInstallDiff,
  normalizeStep,
  tailOutput,
} = require('../report');
const { MAX_SCAN_ITEMS, SCAN_COMMANDS, scanInstallDiff } = require('./vm-scan');

const MAX_EXEC_BUFFER = 1024 * 1024;
const MAX_SCAN_BUFFER = 16 * 1024 * 1024;
const CLEANUP_TIMEOUT_MS = 60_000;
const READY_ATTEMPTS = 20;
const READY_DELAY_MS = 3_000;

function defaultRunner(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    ...options,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: options.maxBuffer || MAX_EXEC_BUFFER,
  });
}

function defaultSleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function succeeded(result) {
  return !result.error && result.status === 0;
}

function resultDetail(result) {
  return tailOutput(
    [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n'),
    50,
    4_000
  );
}

function memoryGiB(memory) {
  const match = memory.match(/^([1-9][0-9]*)(MB|GB)$/);
  if (!match) throw new Error(`Unsupported VM memory value: ${memory}`);
  return match[2] === 'GB' ? Number(match[1]) : Number(match[1]) / 1024;
}

function memoryMiB(memory) {
  const match = memory.match(/^([1-9][0-9]*)(MB|GB)$/);
  if (!match) throw new Error(`Unsupported VM memory value: ${memory}`);
  return match[2] === 'GB' ? Number(match[1]) * 1024 : Number(match[1]);
}

function uniqueVmName(backend) {
  return `ecc-sandbox-${backend}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function launcherIsOwned(child) {
  if (!child || !Number.isInteger(child.pid) || child.pid < 1) return false;
  if (typeof child.isOwned === 'function') {
    try {
      return child.isOwned() === true;
    } catch {
      return false;
    }
  }
  return pidIsAlive(child.pid);
}

function stopOwnedLauncher(child, sleep, timeoutMs = 30_000, lifecycle = {}) {
  const isOwned = lifecycle.isOwned || (() => launcherIsOwned(child));
  const isAlive = lifecycle.isAlive || child?.isAlive || isOwned;
  const signal = lifecycle.signal || ((pid, name) => (
    typeof child?.signalOwned === 'function'
      ? child.signalOwned(name)
      : process.kill(pid, name)
  ));
  const pid = child?.pid;
  if (!Number.isInteger(pid) || pid < 1) return true;
  if (!isOwned(pid)) return !isAlive(pid);
  try {
    if (typeof child?.prepareStop === 'function' && !child.prepareStop()) return false;
    signal(pid, 'SIGINT');
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    return false;
  }
  let waited = 0;
  while (waited < timeoutMs && isAlive(pid)) {
    const delay = Math.min(250, timeoutMs - waited);
    sleep(delay);
    waited += delay;
  }
  return !isAlive(pid);
}

function forceOwnedLauncher(child, sleep, timeoutMs = 5_000) {
  const isAlive = child?.isAlive || (() => launcherIsOwned(child));
  if (!isAlive(child?.pid)) return true;
  try {
    if (typeof child?.forceStop === 'function') {
      if (!child.forceStop()) return false;
    } else if (launcherIsOwned(child)) {
      process.kill(child.pid, 'SIGTERM');
    } else {
      return false;
    }
  } catch (error) {
    if (error.code !== 'ESRCH') return false;
  }
  let waited = 0;
  while (waited < timeoutMs && isAlive(child?.pid)) {
    const delay = Math.min(250, timeoutMs - waited);
    sleep(delay);
    waited += delay;
  }
  return !isAlive(child?.pid);
}

function acquireRunLock(name) {
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error('VM lock name is invalid');
  const lockRoot = path.join(os.tmpdir(), 'ecc-sandbox-locks');
  const lockPath = path.join(lockRoot, `${name}.lock`);
  fs.mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(16).toString('hex');
  const ownerPayload = JSON.stringify({ pid: process.pid, token });
  let created = false;

  try {
    // DECISION: CONVENTIONS item 28 uses an exclusive owner file because it is
    // atomic on Windows and POSIX; directory rename reports EPERM on Windows.
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    created = true;
    try {
      fs.writeFileSync(descriptor, ownerPayload, { encoding: 'utf8' });
    } finally {
      fs.closeSync(descriptor);
    }
    let released = false;
    return {
      pass: true,
      path: lockPath,
      release: () => {
        if (released) return;
        released = true;
        let owner = null;
        try {
          owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        } catch {
          owner = null;
        }
        if (owner?.token === token) {
          fs.rmSync(lockPath, { force: true });
        }
      },
    };
  } catch (error) {
    if (error.code !== 'EEXIST') {
      if (created) fs.rmSync(lockPath, { force: true });
      throw error;
    }
    let owner = null;
    try {
      owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      owner = null;
    }
    const live = owner && pidIsAlive(owner.pid);
    return {
      pass: false,
      path: lockPath,
      stale: !live,
      note: live
        ? 'another ECC macOS guest run is active'
        : `the stale lifecycle lock must be reviewed and removed manually: rm -f -- '${lockPath}'`,
      release: () => {},
    };
  }
}

function executeVm(manifest, options) {
  const driver = options.driver;
  const cwd = path.resolve(options.cwd || process.cwd());
  const vmName = options.vmName || uniqueVmName(driver.backend);
  const seed = options.seed || driver.defaultSeed;
  const run = options.run || defaultRunner;
  const sleep = options.sleep || defaultSleep;
  const clock = options.clock || (() => Date.now());
  const startedMs = clock();
  const started = new Date(startedMs).toISOString();
  const deadline = startedMs + (manifest.resources.timeout * 1000);
  const steps = [];
  const assertions = [];
  const notes = [...(options.notes || [])];
  let installDiff = emptyInstallDiff();
  let cloneAttempted = false;
  let created = false;
  let startedVm = false;
  let executionError = false;
  let cleanupSucceeded = false;
  let unsafeToScan = false;
  let launchProcess = null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(seed)) {
    throw new Error(`${driver.backend} seed name is invalid`);
  }

  const reservation = driver.lockName
    ? acquireRunLock(driver.lockName)
    : { pass: true, release: () => {} };

  const invoke = (argv, maxBuffer = MAX_EXEC_BUFFER, timeout) => run(driver.binary, argv, {
    cwd,
    timeout: timeout || Math.max(1, deadline - clock()),
    maxBuffer,
  });

  try {
  if (!reservation.pass) {
    executionError = true;
    notes.push(`${driver.backend} cannot reserve the shared Apple VM lifecycle lock; ${reservation.note}`);
  } else {
  const seedResult = invoke(driver.seedCheckArgs(seed));
  if (!succeeded(seedResult) || !driver.seedReady(seedResult, { arch: options.arch, os: driver.os })) {
    executionError = true;
    notes.push(`${driver.backend} seed ${seed} is unavailable or not stopped — prepare the operator-trusted seed once: ${driver.seedFix(seed)}`);
    const detail = resultDetail(seedResult);
    if (detail) notes.push(`${driver.backend} seed check: ${detail}`);
  } else {
    const preflight = driver.preflight
      ? driver.preflight(invoke, notes, options.mock ? null : run)
      : { pass: true };
    if (!preflight.pass) {
      executionError = true;
      notes.push(preflight.note);
    } else {
      cloneAttempted = true;
      const clone = invoke(driver.cloneArgs(seed, vmName, manifest));
      if (!succeeded(clone)) {
        executionError = true;
        notes.push(`${driver.backend} clone failed: ${resultDetail(clone) || 'unknown error'}`);
      } else {
        created = true;
        notes.push(`vm_seed=${seed}`);
        notes.push(`vm_name=${vmName}`);
        const configureResult = driver.configureArgs
          ? invoke(driver.configureArgs(vmName, manifest))
          : { status: 0, stdout: '', stderr: '', error: null };
        if (!succeeded(configureResult)) {
          executionError = true;
          notes.push(`${driver.backend} resource configuration failed: ${resultDetail(configureResult) || 'unknown error'}`);
        } else {
          const startMs = clock();
          const startResult = options.start
            ? options.start(driver.binary, driver.startArgs(vmName, manifest), { cwd })
            : invoke(driver.startArgs(vmName, manifest));
          launchProcess = startResult.child || null;
          notes.push(`vm_start_ms=${Math.max(0, clock() - startMs)}`);
          if (!succeeded(startResult)) {
            executionError = true;
            notes.push(`${driver.backend} start failed: ${resultDetail(startResult) || 'unknown error'}`);
          } else {
            startedVm = true;
            let ready = {
              status: null,
              stdout: '',
              stderr: '',
              error: new Error('manifest deadline expired before guest readiness'),
            };
            for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
              const remainingMs = deadline - clock();
              if (remainingMs <= 0) break;
              ready = invoke(
                driver.readyArgs(vmName),
                MAX_EXEC_BUFFER,
                Math.max(1, Math.min(10_000, remainingMs))
              );
              if (succeeded(ready)) break;
              const sleepMs = Math.min(READY_DELAY_MS, Math.max(0, deadline - clock()));
              if (attempt + 1 < READY_ATTEMPTS && sleepMs > 0) sleep(sleepMs);
            }
            if (!succeeded(ready)) {
              executionError = true;
              notes.push(`${driver.backend} guest did not become ready: ${resultDetail(ready) || 'SSH unavailable'}`);
            } else {
              if (
                !options.mock
                && driver.ownershipArgs
                && driver.ownershipMarker
                && launchProcess?.addOwnershipMarker
              ) {
                const ownershipRemainingMs = deadline - clock();
                const ownership = ownershipRemainingMs > 0
                  ? invoke(
                    driver.ownershipArgs(vmName),
                    MAX_EXEC_BUFFER,
                    Math.max(1, Math.min(10_000, ownershipRemainingMs))
                  )
                  : {
                    status: null,
                    stdout: '',
                    stderr: '',
                    error: new Error('manifest deadline expired before helper ownership lookup'),
                  };
                const marker = succeeded(ownership) ? driver.ownershipMarker(ownership) : null;
                if (!marker || !launchProcess.addOwnershipMarker(marker)) {
                  executionError = true;
                  notes.push(`${driver.backend} could not establish its helper ownership marker`);
                } else if (launchProcess.helperBarrierReady) {
                  let stableSamples = 0;
                  for (let attempt = 0; attempt < 20 && stableSamples < 2; attempt += 1) {
                    if (deadline - clock() <= 0) break;
                    stableSamples = launchProcess.helperBarrierReady() ? stableSamples + 1 : 0;
                    if (stableSamples < 2) sleep(Math.min(250, Math.max(0, deadline - clock())));
                  }
                  if (stableSamples < 2) {
                    executionError = true;
                    notes.push(`${driver.backend} did not reach a verified helper-free readiness barrier`);
                  } else {
                    notes.push(`${driver.backend}_helper_barrier=verified`);
                  }
                }
              }
              let beforeScan = null;
              if (!executionError && manifest.report === 'install-diff') {
                beforeScan = invoke(
                  (driver.scanArgs || driver.execArgs)(
                    vmName, SCAN_COMMANDS[driver.os], manifest.resources.timeout
                  ),
                  MAX_SCAN_BUFFER
                );
                if (!succeeded(beforeScan)) {
                  executionError = true;
                  notes.push(`${driver.backend} pre-run filesystem scan failed: ${resultDetail(beforeScan)}`);
                }
              }

              const execute = (command, assertion) => {
                const remainingSeconds = Math.max(1, Math.ceil((deadline - clock()) / 1000));
                const execution = invoke(driver.execArgs(vmName, command, remainingSeconds));
                const step = normalizeStep(command, execution);
                steps.push(step);
                if (assertion) assertions.push({ cmd: command, pass: step.exit === 0 });
                if (execution.error || execution.status === null) {
                  executionError = true;
                  unsafeToScan = true;
                }
                return step.exit === 0;
              };

              if (!executionError) {
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

              if (manifest.report === 'install-diff' && beforeScan && !unsafeToScan) {
                const afterScan = invoke(
                  (driver.scanArgs || driver.execArgs)(
                    vmName, SCAN_COMMANDS[driver.os], manifest.resources.timeout
                  ),
                  MAX_SCAN_BUFFER
                );
                if (!succeeded(afterScan)) {
                  executionError = true;
                  notes.push(`${driver.backend} post-run filesystem scan failed: ${resultDetail(afterScan)}`);
                } else {
                  const parsed = scanInstallDiff(beforeScan.stdout, afterScan.stdout, driver.os);
                  installDiff = parsed.diff;
                  notes.push('VM install diff is a bounded best-effort path scan, not a complete disk diff');
                  if (parsed.malformed) notes.push('VM scan ignored malformed path records');
                  if (parsed.truncated) notes.push(`VM scan diff exceeded ${MAX_SCAN_ITEMS} entries and was truncated`);
                  // A bounded report is still valid evidence: `complete:false`
                  // and the note make the loss explicit. Malformed records can
                  // indicate a broken transport or parser contract and fail.
                  if (parsed.malformed) executionError = true;
                }
              }
            }
          }
        }
      }
    }
  }
  }

  } catch (error) {
    executionError = true;
    notes.push(`${driver.backend} adapter error: ${resultDetail({ error }) || error.message}`);
  } finally {
    let launcherStopped = false;
    if (startedVm && launchProcess && driver.stopViaLauncher) {
      launcherStopped = stopOwnedLauncher(launchProcess, sleep, CLEANUP_TIMEOUT_MS / 2);
      if (!launcherStopped) {
        launcherStopped = forceOwnedLauncher(launchProcess, sleep, CLEANUP_TIMEOUT_MS / 4);
        if (launcherStopped) {
          notes.push(`${driver.backend} owned launcher required forced process-tree cleanup`);
        } else {
          executionError = true;
          notes.push(`${driver.backend} owned launcher process tree did not stop`);
        }
      }
    }
    if (startedVm && !launcherStopped) {
      try {
        const stop = invoke(driver.stopArgs(vmName), MAX_EXEC_BUFFER, CLEANUP_TIMEOUT_MS);
        if (!succeeded(stop)) notes.push(`${driver.backend} stop failed before forced deletion: ${resultDetail(stop)}`);
      } catch (error) {
        executionError = true;
        notes.push(`${driver.backend} stop raised an adapter error: ${error.message}`);
      }
    }
    if (cloneAttempted) {
      try {
        const deletion = invoke(driver.deleteArgs(vmName), MAX_EXEC_BUFFER, CLEANUP_TIMEOUT_MS);
        cleanupSucceeded = succeeded(deletion) || (!created && driver.missingInstance(deletion));
      } catch (error) {
        cleanupSucceeded = false;
        notes.push(`${driver.backend} deletion raised an adapter error: ${error.message}`);
      }
      if (!cleanupSucceeded) {
        executionError = true;
        notes.push(`${driver.backend} cleanup failed for ${vmName} — remove it manually: ${driver.cleanupFix(vmName)}`);
      }
    }
    if (launchProcess) {
      try {
        if (
          driver.stopViaLauncher
          && !forceOwnedLauncher(launchProcess, sleep, CLEANUP_TIMEOUT_MS / 4)
        ) {
          executionError = true;
          notes.push(`${driver.backend} launcher process tree remains active after cleanup`);
        } else if (!driver.stopViaLauncher && launcherIsOwned(launchProcess)) {
          process.kill(launchProcess.pid, 'SIGTERM');
        }
        launchProcess.unref();
      } catch (error) {
        executionError = true;
        notes.push(`${driver.backend} launcher cleanup failed: ${error.message}`);
      }
    }
    try {
      reservation.release();
    } catch (error) {
      executionError = true;
      notes.push(`${driver.backend} reservation release failed: ${error.message}`);
    }
  }
  if (options.mock) notes.push(`Mock ${driver.backend} execution: no VM was created`);
  notes.push(`vm_seed_trust=operator-managed; stopped state is verified, disk provenance is not attested`);
  notes.push(...(driver.notes || []));
  notes.push(`${driver.backend} configures requested cpu and memory; v1 does not enforce guest network policy`);

  const report = buildSingleReport({
    manifest: options.manifestPath,
    backend: driver.backend,
    tier: 2,
    os: driver.os,
    arch: options.arch,
    executionMode: options.mock ? 'mock' : 'real',
    started,
    durationMs: clock() - startedMs,
    steps,
    assertions,
    installDiff,
    executionError,
    notes,
  });
  return {
    report,
    exitCode: report.result === 'pass' ? 0 : (report.result === 'fail' ? 1 : 2),
    cleanup: { attempted: cloneAttempted, pass: cleanupSucceeded, vm: vmName },
  };
}

module.exports = {
  CLEANUP_TIMEOUT_MS,
  MAX_EXEC_BUFFER,
  MAX_SCAN_BUFFER,
  READY_ATTEMPTS,
  READY_DELAY_MS,
  defaultRunner,
  defaultSleep,
  executeVm,
  forceOwnedLauncher,
  acquireRunLock,
  launcherIsOwned,
  memoryGiB,
  memoryMiB,
  pidIsAlive,
  resultDetail,
  stopOwnedLauncher,
  uniqueVmName,
};
