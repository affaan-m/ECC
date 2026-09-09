'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const { assessHostResources } = require('./host-resources');
const { vmStoragePath, vmCloneBudget, withLumeStorage } = require('./vm-storage');
const { prepareLumeClone } = require('./lume-clone');
const { LUME_DRIVER } = require('./backends/lume');
const { LIMA_DRIVER } = require('./backends/lima');
const { TART_DRIVER } = require('./backends/tart');

// Advisory only. Compiles/probes the local COW helper when needed, but never
// creates a VM or run. Execution repeats admission under the lifecycle lock.
function resourcePreflight(resolved, dependencies = {}) {
  const run = dependencies.run || spawnSync;
  const drivers = { lume: LUME_DRIVER, lima: LIMA_DRIVER, tart: TART_DRIVER };
  const assess = dependencies.assessHostResources || assessHostResources;
  const checks = resolved.decision.routes.map(route => {
    const base = { backend: route.backend || null, tier: route.tier ?? null };
    if (route.result === 'error') {
      return { ...base, decision: 'deny', message: `${route.reason}. ${route.fix || ''}`.trim() };
    }
    const driver = drivers[route.backend];
    if (!driver) return { ...base, decision: 'deny', message: 'Resource preflight currently supports local Lume, Lima, and Tart VM routes only.' };
    try {
      const seed = process.env[`ECC_SANDBOX_${route.backend.toUpperCase()}_SEED`] || driver.defaultSeed;
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(seed)) throw new Error('VM seed name is invalid');
      const storagePath = (dependencies.vmStoragePath || vmStoragePath)(route.backend, seed, null, { run });
      const preliminary = assess(resolved.manifest, { storagePath, cloneBytes: 0 });
      if (preliminary.decision !== 'allow') return { ...base, decision: 'deny', admission: preliminary };
      const inspectSeed = () => run(driver.binary, route.backend === 'lume'
        ? withLumeStorage(driver.seedCheckArgs(seed), storagePath) : driver.seedCheckArgs(seed), {
        encoding: 'utf8', shell: false, timeout: 5_000, maxBuffer: 65_536,
      });
      const seedResult = inspectSeed();
      const ready = result => !result.error && result.status === 0
        && driver.seedReady(result, { arch: route.arch, os: driver.os });
      if (!ready(seedResult)) throw new Error(`Seed ${seed} must be prepared and stopped before a VM can launch`);
      const clonePlan = route.backend === 'lume' ? (dependencies.prepareLumeClone || prepareLumeClone)(
        path.join(storagePath, seed), path.join(storagePath, `ecc-sandbox-lume-preflight-${crypto.randomBytes(8).toString('hex')}`),
        { verifySourceStopped: () => ready(inspectSeed()) }
      ) : null;
      const cloneBytes = clonePlan?.supported ? clonePlan.cloneBytes
        : (dependencies.vmCloneBudget || vmCloneBudget)(route.backend, seed, seedResult, { run, storagePath });
      const admission = assess(resolved.manifest, { storagePath, cloneBytes });
      return { ...base, decision: admission.decision, admission,
        ...(clonePlan ? { clone_strategy: clonePlan.message } : {}) };
    } catch (error) {
      return { ...base, decision: 'deny', message: `VM launch refused: ${error.message}` };
    }
  });
  return {
    schema_version: 1, manifest: resolved.manifestPath,
    result: checks.length && checks.every(check => check.decision === 'allow') ? 'ready' : 'error',
    creates_run: false, checks,
    note: 'Advisory resource snapshot only. Execution must recheck host resources and runtime prerequisites immediately before launch.',
  };
}

module.exports = { resourcePreflight };
