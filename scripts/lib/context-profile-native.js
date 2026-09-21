'use strict';

// Explicit isolated provider homes only. The managed profile remains authority;
// the native pointer is a disposable projection for a future launched session.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const io = require('./context-profile-store-fs');
const { getStoreStatus } = require('./context-profile-store');
const { digestObject, stableStringify, validateSchema } = require('./context-profile-support');
const { discoverSync } = require('./context-profile-native-discovery');
const { fingerprintExecutable, resolveExecutable } = require('./context-profile-native-executable');

const VERSION = '0.154.0';
// 0.155.1: credential-free native-probe verified Lean, include, Full exclusion and resource relocation.
const SUPPORTED_VERSIONS = ['0.154.0', '0.155.1'];
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KEYS = new Set(['stateRoot', 'nativeRoot', 'expectedRevision', 'expectedCarrierDigest', 'codexPath']);
const CONTROLS = ['marketplace', 'project', 'home/.agents', 'home/.codex/config.toml',
  'home/.codex/AGENTS.md', 'home/.codex/AGENTS.override.md', 'home/.codex/hooks.json',
  'home/.codex/requirements.toml', 'home/.codex/plugins', 'home/.codex/skills'];
const exists = file => Boolean(fs.lstatSync(file, { throwIfNoEntry: false }));
const equal = (a, b) => stableStringify(a) === stableStringify(b);
const inside = (a, b) => a === b || a.startsWith(`${b}${path.sep}`);

function inputs(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Native profile options must be an object');
  for (const key of Object.keys(options)) if (!KEYS.has(key)) throw new Error(`Unknown native profile option: ${key}`);
  const { nativeRoot, stateRoot } = options;
  if (typeof nativeRoot !== 'string' || !path.isAbsolute(nativeRoot) || path.resolve(nativeRoot) !== nativeRoot
    || nativeRoot === path.parse(nativeRoot).root || nativeRoot === os.homedir()
    || nativeRoot === path.join(os.homedir(), '.codex') || nativeRoot === process.env.CODEX_HOME) {
    throw new Error('nativeRoot must be an explicit dedicated isolated root');
  }
  if (typeof stateRoot !== 'string' || !path.isAbsolute(stateRoot)) throw new Error('Managed stateRoot is required');
  if (inside(nativeRoot, stateRoot) || inside(stateRoot, nativeRoot)) throw new Error('Native and managed roots must not overlap');
  io.inspect(stateRoot);
  const canonicalState = fs.realpathSync(stateRoot);
  const canonicalNative = exists(nativeRoot) ? fs.realpathSync(nativeRoot)
    : path.join(fs.realpathSync(path.dirname(nativeRoot)), path.basename(nativeRoot));
  const normalized = value => process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
  const forbidden = [os.homedir(), path.join(os.homedir(), '.codex'), process.env.CODEX_HOME].filter(Boolean);
  if (forbidden.some(file => normalized(exists(file) ? fs.realpathSync(file) : file) === normalized(canonicalNative))) {
    throw new Error('nativeRoot must be an explicit dedicated isolated root');
  }
  if (inside(normalized(canonicalNative), normalized(canonicalState)) || inside(normalized(canonicalState), normalized(canonicalNative))) {
    throw new Error('Native and managed roots must not overlap');
  }
  if (options.expectedRevision !== undefined && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)) {
    throw new Error('Invalid native expected revision');
  }
  if (options.expectedCarrierDigest !== undefined && !DIGEST.test(options.expectedCarrierDigest)) throw new Error('Invalid native expected carrier digest');
  if (options.codexPath !== undefined && (typeof options.codexPath !== 'string'
    || (options.codexPath !== 'codex' && !path.isAbsolute(options.codexPath)))) throw new Error('codexPath must be codex or an absolute executable path');
  io.inspect(nativeRoot, true);
  return { ...options, codexPath: options.codexPath || 'codex' };
}

function owner(options, create = false) {
  const marker = { schemaVersion: 'ecc.native-context-root.v1',
    bindingDigest: digestObject({ nativeRoot: options.nativeRoot, stateRoot: options.stateRoot }) };
  if (!exists(options.nativeRoot)) {
    if (!create) return false;
    io.mkdir(options.nativeRoot); io.writeExclusive(path.join(options.nativeRoot, 'owner.json'), io.jsonBytes(marker));
  }
  const stat = io.inspect(options.nativeRoot).stat;
  if (!stat.isDirectory() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0
    || (process.getuid && stat.uid !== process.getuid())))) throw new Error('Native root must be a private owned directory');
  const file = path.join(options.nativeRoot, 'owner.json');
  if (!exists(file) || !equal(io.readJson(file), marker)) throw new Error('Native root is not an owned ECC isolated root');
  return true;
}

function currentStore(options) {
  const current = getStoreStatus({ stateRoot: options.stateRoot });
  if (!current.configured || current.recoveryRequired || current.target !== 'codex') {
    throw new Error('Native preparation requires a configured, recovered Codex managed store');
  }
  if (options.expectedCarrierDigest && current.carrierDigest !== options.expectedCarrierDigest) throw new Error('Managed carrier digest changed since preview');
  return current;
}

function generation(options, id) {
  if (!ID.test(id)) throw new Error('Invalid native generation ID');
  return path.join(options.nativeRoot, 'generations', id);
}

function readState(options) {
  const file = path.join(options.nativeRoot, 'state.json');
  if (!exists(file)) return null;
  const state = io.readJson(file);
  if (state.schemaVersion !== 'ecc.native-context-state.v1' || !Number.isSafeInteger(state.revision)
    || state.revision < 1 || !Number.isSafeInteger(state.storeRevision) || state.storeRevision < 1
    || !DIGEST.test(state.receiptDigest) || !DIGEST.test(state.generationReceiptDigest) || !ID.test(state.generationId)
    || (state.previousGenerationId !== null && (!ID.test(state.previousGenerationId) || !DIGEST.test(state.previousGenerationReceiptDigest)))
    || (state.previousGenerationId === null && state.previousGenerationReceiptDigest !== null)) throw new Error('Native state integrity failed');
  const transition = io.readJson(path.join(options.nativeRoot, 'receipts', `${state.receiptDigest}.json`));
  const { receiptDigest, ...body } = state;
  if (digestObject(transition) !== receiptDigest || !equal(transition, body)) throw new Error('Native transition receipt integrity failed');
  return state;
}

function snapshot(root) {
  return CONTROLS.map(relative => {
    const file = path.join(root, relative);
    if (!exists(file)) return { path: relative, kind: 'absent' };
    const stat = io.inspect(file).stat;
    if (stat.isDirectory()) {
      const tree = io.inventory(file);
      return { path: relative, kind: 'directory', files: tree.files.sort((a, b) => a.path.localeCompare(b.path)),
        directories: tree.directories.sort() };
    }
    const bytes = io.read(file);
    return { path: relative, kind: 'file', bytes: bytes.length, digest: io.hash(bytes) };
  });
}

function loadReceipt(options, state, { allowRefresh = false } = {}) {
  const root = generation(options, state.generationId);
  const receipt = io.readJson(path.join(root, 'receipt.json'));
  if (digestObject(receipt) !== state.generationReceiptDigest || receipt.schemaVersion !== 'ecc.native-context-receipt.v1'
    || receipt.generationId !== state.generationId || !SUPPORTED_VERSIONS.includes(receipt.providerVersion)
    || receipt.bindingDigest !== digestObject({ nativeRoot: options.nativeRoot, stateRoot: options.stateRoot })) {
    throw new Error('Native receipt integrity failed');
  }
  const carrier = io.readJson(path.join(root, 'carrier.json'));
  validateSchema(carrier, 'context-carrier.schema.json');
  const { carrierDigest, ...body } = carrier;
  if (carrierDigest !== receipt.carrierDigest || digestObject(body) !== carrierDigest) throw new Error('Native carrier digest integrity failed');
  if (!equal(snapshot(root), receipt.controls)) throw new Error('Native discovery configuration or skill bytes changed');
  if (!allowRefresh && (!receipt.executable || !equal(fingerprintExecutable(receipt.executable.path), receipt.executable))) {
    throw new Error('Native Codex executable changed since preparation');
  }
  if (receipt.bootstrap) {
    if (receipt.bootstrap.stateRoot !== options.stateRoot || receipt.bootstrap.nativeRoot !== options.nativeRoot
      || receipt.bootstrap.carrierDigest !== receipt.carrierDigest) throw new Error('Interactive root binding integrity failed');
    if (!allowRefresh) require('./context-profile-interactive').verifyBootstrap(receipt.bootstrap);
  }
  return { receipt, carrier, root };
}

function response(options, state, current, pending = false, allowRefresh = false) {
  const base = { schemaVersion: 'ecc.native-context-status.v1', nativeRoot: options.nativeRoot,
    stateRoot: options.stateRoot, active: false, ready: false, revision: state?.revision || 0,
    status: pending ? 'recovery-required' : 'unconfigured', target: 'codex',
    providerVersion: VERSION, home: null, codexHome: null, carrierDigest: null, storeRevision: null,
    currentStoreRevision: current.revision, currentCarrierDigest: current.carrierDigest,
    discovery: 'unobserved', currentSessionChanged: false, credentialsCopied: false };
  if (!state) return base;
  const { receipt, carrier, root } = loadReceipt(options, state, { allowRefresh });
  let bindingsMatch = true;
  if (allowRefresh) {
    try {
      bindingsMatch = equal(fingerprintExecutable(receipt.executable.path), receipt.executable);
      if (receipt.bootstrap) require('./context-profile-interactive').verifyBootstrap(receipt.bootstrap);
    } catch { bindingsMatch = false; }
  }
  const matches = state.storeRevision === current.revision && receipt.carrierDigest === current.carrierDigest;
  return { ...base, status: pending ? 'recovery-required' : !bindingsMatch ? 'refresh-required' : matches ? 'ready' : 'stale',
    ready: matches && bindingsMatch && !pending, providerVersion: receipt.providerVersion, bootstrap: receipt.bootstrap || null,
    home: path.join(root, 'home'), codexHome: path.join(root, 'home/.codex'),
    carrierDigest: receipt.carrierDigest, storeRevision: state.storeRevision,
    codexPath: receipt.executable.path, executable: receipt.executable.path, executableDigest: receipt.executable.digest,
    selectedIds: carrier.selectedIds, discovery: 'verified', evidenceScope: 'native-preparation-with-current-file-integrity',
    activation: 'isolated-home-ready-for-new-session', modelInvocation: 'unobserved' };
}

function getNativeProfileStatus(input) {
  const options = inputs(input); const current = currentStore(options);
  if (!owner(options)) return response(options, null, current);
  return response(options, readState(options), current,
    exists(path.join(options.nativeRoot, 'pending.json')) || exists(path.join(options.nativeRoot, '.lock')));
}

function previewNativeProfile(input) {
  const options = inputs(input); const current = currentStore(options);
  const before = owner(options) ? response(options, readState(options), current,
    exists(path.join(options.nativeRoot, 'pending.json')) || exists(path.join(options.nativeRoot, '.lock')), true)
    : response(options, null, current);
  if (options.expectedRevision !== undefined && options.expectedRevision !== before.revision) throw new Error('Native revision changed since preview');
  return { ...before, status: 'proposed', ready: false, proposedCarrierDigest: current.carrierDigest,
    proposedStoreRevision: current.revision, requiredProviderVersion: VERSION, supportedProviderVersions: [...SUPPORTED_VERSIONS] };
}

function environment(root) {
  const env = { PATH: process.env.PATH, HOME: path.join(root, 'home'), CODEX_HOME: path.join(root, 'home/.codex'), LANG: 'C.UTF-8' };
  if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return env;
}

function command(options, root, args, dependencies) {
  if (options.executableBinding && !equal(fingerprintExecutable(options.codexPath), options.executableBinding)) {
    throw new Error('Native executable changed before provider call');
  }
  const result = (dependencies.execute || spawnSync)(options.codexPath, args, {
    cwd: path.join(root, 'project'), env: environment(root), encoding: 'utf8', shell: false,
    timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Native Codex command failed; isolated attempt retained for recovery');
  if (typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > 2 * 1024 * 1024) throw new Error('Native Codex command output exceeded its bound');
  return result.stdout.trim();
}

function verifyNative(options, root, carrier, dependencies) {
  if (command(options, root, ['--version'], dependencies) !== `codex-cli ${options.providerVersion}`) throw new Error('Native Codex version changed since verification');
  const env = environment(root); const marketplaceName = `ecc-context-${carrier.carrierDigest.slice(0, 16)}`;
  const cache = path.join(env.CODEX_HOME, 'plugins/cache', marketplaceName, 'ecc-context-carrier/local');
  const result = (dependencies.discover || discoverSync)(options.codexPath, { cwd: path.join(root, 'project'), env });
  if (!result || !Array.isArray(result.data) || result.data.length !== 1 || !equal(result.data[0].errors, [])
    || result.data[0].cwd !== path.join(root, 'project')
    || !Array.isArray(result.data[0].skills)) throw new Error('Native skill discovery shape, project binding or parser errors');
  const selected = result.data[0].skills.filter(skill => skill.pluginId === `ecc-context-carrier@${marketplaceName}`);
  const expectedNames = carrier.entries.map(entry => `ecc-context-carrier:${entry.name}`).sort();
  if (!equal(selected.map(skill => skill.name).sort(), expectedNames)) throw new Error('Native skill discovery selection mismatch');
  for (const skill of result.data[0].skills) {
    if (skill.pluginId !== `ecc-context-carrier@${marketplaceName}`) {
      if (skill.scope !== 'system' || skill.pluginId || !inside(skill.path, path.join(env.CODEX_HOME, 'skills/.system'))) throw new Error('Native extra skill discovery');
      continue;
    }
    const name = skill.name.slice('ecc-context-carrier:'.length);
    if (!skill.enabled || skill.path !== path.join(cache, 'skills', name, 'SKILL.md')) throw new Error('Native skill discovery enabled state or path mismatch');
  }
  const observed = io.inventory(cache).files.sort((a, b) => a.path.localeCompare(b.path));
  const expected = carrier.files.map(file => ({ path: file.destinationPath, bytes: file.bytes, digest: file.digest }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!equal(observed, expected)) throw new Error('Native installed file set or digest mismatch');
}

function checkpoint(dependencies, point) { if (dependencies.onCheckpoint) dependencies.onCheckpoint(point); }

function locked(options, recover, work) {
  const file = path.join(options.nativeRoot, '.lock');
  if (exists(file)) {
    const prior = io.readJson(file);
    if (!recover || prior.hostname !== os.hostname() || !Number.isSafeInteger(prior.pid) || prior.pid < 1) throw new Error('Native lock requires explicit recovery');
    try { process.kill(prior.pid, 0); throw new Error('Native lock is held by a live process'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (!equal(io.readJson(file), prior)) throw new Error('Native lock changed');
    fs.unlinkSync(file);
  }
  const lock = { pid: process.pid, hostname: os.hostname(), nonce: crypto.randomUUID() };
  io.writeExclusive(file, io.jsonBytes(lock));
  try { return work(); }
  finally { if (equal(io.readJson(file), lock)) { fs.unlinkSync(file); io.syncDirectory(options.nativeRoot); } }
}

function recheckStore(options, current) {
  const now = currentStore(options);
  if (now.revision !== current.revision || now.carrierDigest !== current.carrierDigest) throw new Error('Managed store binding changed during native preparation');
}

function publish(options, before, current, generationId, receipt, dependencies) {
  recheckStore(options, current);
  loadReceipt(options, { generationId, generationReceiptDigest: digestObject(receipt) });
  if (before) loadReceipt(options, before, { allowRefresh: true });
  if (!equal(readState(options), before)) throw new Error('Native state changed before publication');
  const transition = { schemaVersion: 'ecc.native-context-state.v1', revision: (before?.revision || 0) + 1,
    generationId, previousGenerationId: before?.generationId || null,
    previousGenerationReceiptDigest: before?.generationReceiptDigest || null,
    generationReceiptDigest: digestObject(receipt), storeRevision: current.revision };
  const state = { ...transition, receiptDigest: digestObject(transition) };
  io.mkdir(path.join(options.nativeRoot, 'receipts'));
  io.writeExclusive(path.join(options.nativeRoot, 'receipts', `${state.receiptDigest}.json`), io.jsonBytes(transition));
  io.atomicJson(path.join(options.nativeRoot, 'state.json'), state);
  checkpoint(dependencies, 'state-published');
  fs.unlinkSync(path.join(options.nativeRoot, 'pending.json')); io.syncDirectory(options.nativeRoot);
  return response(options, state, current);
}

function register(options, root, carrier, current, dependencies) {
  for (const relative of ['home', 'home/.codex', 'project', 'marketplace', 'marketplace/.agents', 'marketplace/.agents/plugins', 'marketplace/carrier']) {
    io.mkdir(path.join(root, relative));
  }
  const version = command(options, root, ['--version'], dependencies);
  const providerVersion = SUPPORTED_VERSIONS.find(value => version === `codex-cli ${value}`);
  if (!providerVersion) throw new Error(`Native Codex version must be exactly ${SUPPORTED_VERSIONS.join(' or ')}`);
  for (const file of carrier.files) {
    const relative = `marketplace/carrier/${file.destinationPath}`;
    const bytes = io.read(path.join(current.generationRoot, file.destinationPath));
    if (io.hash(bytes) !== file.digest || bytes.length !== file.bytes) throw new Error('Managed carrier source digest changed');
    io.ensureParents(root, relative); io.writeExclusive(path.join(root, relative), bytes);
  }
  const name = `ecc-context-${carrier.carrierDigest.slice(0, 16)}`;
  io.writeExclusive(path.join(root, 'marketplace/.agents/plugins/marketplace.json'), io.jsonBytes({ name,
    plugins: [{ name: 'ecc-context-carrier', source: { source: 'local', path: './carrier' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }] }));
  command(options, root, ['plugin', 'marketplace', 'add', path.join(root, 'marketplace'), '--json'], dependencies);
  command(options, root, ['plugin', 'add', `ecc-context-carrier@${name}`, '--json'], dependencies);
  checkpoint(dependencies, 'registered');
  verifyNative({ ...options, providerVersion }, root, carrier, dependencies);
  return providerVersion;
}

function prepareNativeProfile(input, dependencies = {}) {
  let options = inputs(input); const current = currentStore(options);
  previewNativeProfile(options);
  const executable = resolveExecutable(options.codexPath);
  owner(options, true);
  options = { ...options, codexPath: executable.path, executableBinding: executable };
  return locked(options, false, () => {
    if (exists(path.join(options.nativeRoot, 'pending.json'))) throw new Error('Native attempt requires recovery');
    const before = readState(options);
    if (options.expectedRevision !== undefined && options.expectedRevision !== (before?.revision || 0)) throw new Error('Native revision changed since preview');
    const previous = before ? loadReceipt(options, before, { allowRefresh: true }) : null;
    const bootstrap = require('./context-profile-interactive').bootstrapFor(options, current);
    if (before && before.storeRevision === current.revision) {
      if (previous.receipt.carrierDigest === current.carrierDigest && equal(previous.receipt.executable, executable) && equal(previous.receipt.bootstrap, bootstrap.binding)) {
        verifyNative({ ...options, providerVersion: previous.receipt.providerVersion }, previous.root, previous.carrier, dependencies);
        recheckStore(options, current);
        return response(options, before, current);
      }
    }
    const generationId = crypto.randomUUID();
    const pending = { schemaVersion: 'ecc.native-context-pending.v1', before, generationId,
      carrierDigest: current.carrierDigest, storeRevision: current.revision };
    io.atomicJson(path.join(options.nativeRoot, 'pending.json'), pending); checkpoint(dependencies, 'prepared');
    io.mkdir(path.join(options.nativeRoot, 'generations'));
    const root = generation(options, generationId); io.mkdir(root);
    const carrier = io.readJson(path.join(path.dirname(current.generationRoot), 'carrier.json'));
    validateSchema(carrier, 'context-carrier.schema.json');
    const { carrierDigest, ...body } = carrier;
    if (carrierDigest !== current.carrierDigest || digestObject(body) !== carrierDigest) throw new Error('Managed carrier descriptor changed before native registration');
    io.writeExclusive(path.join(root, 'carrier.json'), io.jsonBytes(carrier));
    const providerVersion = register(options, root, carrier, current, dependencies);
    io.writeExclusive(path.join(root, 'home/.codex/AGENTS.md'), bootstrap.bytes);
    const receipt = { schemaVersion: 'ecc.native-context-receipt.v1', generationId,
      bindingDigest: digestObject({ nativeRoot: options.nativeRoot, stateRoot: options.stateRoot }),
      carrierDigest: carrier.carrierDigest, providerVersion, executable, bootstrap: bootstrap.binding, controls: snapshot(root) };
    io.writeExclusive(path.join(root, 'receipt.json'), io.jsonBytes(receipt));
    checkpoint(dependencies, 'verified');
    return publish(options, before, current, generationId, receipt, dependencies);
  });
}

function rollbackNativeProfile(input, dependencies = {}) {
  const options = inputs(input); const current = currentStore(options);
  if (!owner(options)) throw new Error('Native rollback requires a previous generation');
  return locked(options, false, () => {
    if (exists(path.join(options.nativeRoot, 'pending.json'))) throw new Error('Native attempt requires recovery');
    const before = readState(options);
    if (!before?.previousGenerationId) throw new Error('Native rollback requires a previous generation');
    if (options.expectedRevision !== undefined && options.expectedRevision !== before.revision) throw new Error('Native revision changed');
    const root = generation(options, before.previousGenerationId);
    const receipt = io.readJson(path.join(root, 'receipt.json'));
    const previous = loadReceipt(options, { generationId: before.previousGenerationId,
      generationReceiptDigest: before.previousGenerationReceiptDigest });
    if (receipt.carrierDigest !== current.carrierDigest) throw new Error('Rollback the managed store to the previous native carrier first');
    verifyNative({ ...options, providerVersion: receipt.providerVersion, codexPath: receipt.executable.path, executableBinding: receipt.executable }, root, previous.carrier, dependencies);
    io.atomicJson(path.join(options.nativeRoot, 'pending.json'), { schemaVersion: 'ecc.native-context-pending.v1',
      before, generationId: before.previousGenerationId, carrierDigest: current.carrierDigest, storeRevision: current.revision });
    return publish(options, before, current, before.previousGenerationId, receipt, dependencies);
  });
}

function recoverNativeProfile(input) {
  const options = inputs(input); const current = currentStore(options);
  if (!owner(options)) return response(options, null, current);
  return locked(options, true, () => {
    const file = path.join(options.nativeRoot, 'pending.json');
    if (!exists(file)) return response(options, readState(options), current, false, true);
    const pending = io.readJson(file); const state = readState(options);
    if (pending.schemaVersion !== 'ecc.native-context-pending.v1' || !ID.test(pending.generationId)
      || !DIGEST.test(pending.carrierDigest) || !Number.isSafeInteger(pending.storeRevision)) throw new Error('Native pending integrity failed');
    const committed = state && state.generationId === pending.generationId
      && state.storeRevision === pending.storeRevision && state.revision === (pending.before?.revision || 0) + 1;
    if (!committed && !equal(state, pending.before)) throw new Error('Native state changed outside pending attempt');
    const result = response(options, state, current, false, true);
    // Retain unselected attempts. Recovery never deletes provider or unrelated data.
    fs.unlinkSync(file); io.syncDirectory(options.nativeRoot);
    return { ...result, retainedAttemptRoot: generation(options, pending.generationId) };
  });
}

module.exports = { getNativeProfileStatus, prepareNativeProfile, previewNativeProfile, recoverNativeProfile, rollbackNativeProfile };
