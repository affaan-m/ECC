'use strict';

// Explicit isolated provider homes only. The managed profile remains authority;
// the native pointer is a disposable projection for a future launched session.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOML = require('@iarna/toml');
const io = require('./context-profile-store-fs');
const { getStoreStatus } = require('./context-profile-store');
const { digestObject, stableStringify, validateSchema } = require('./context-profile-support');
const { discoverSync } = require('./context-profile-native-discovery');
const { fingerprintExecutable, resolveExecutable } = require('./context-profile-native-executable');

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KEYS = new Set(['stateRoot', 'nativeRoot', 'expectedRevision', 'expectedCarrierDigest', 'codexPath', 'claudePath']);
const PLUGIN = 'ecc-context-carrier';
// Claude loads the carrier per session with --plugin-dir; nothing is installed.
// Official marketplace auto-install would add plugins to the isolated home.
const CLAUDE_ISOLATION_ENV = Object.freeze({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1' });
const PROVIDERS = Object.freeze({
  codex: { label: 'Codex', command: 'codex', executableKey: 'codexPath',
    // 0.155.1: credential-free native-probe verified Lean, include, Full exclusion and resource relocation.
    requiredVersion: '0.154.0', versions: ['0.154.0', '0.155.1'], parseVersion: output => /^codex-cli (\S+)$/.exec(output)?.[1] ?? null,
    admits(version) { return this.versions.includes(version); },
    bootstrapPath: 'home/.codex/AGENTS.md',
    controls: ['marketplace', 'project', 'home/.agents', 'home/.codex/config.toml',
      'home/.codex/AGENTS.md', 'home/.codex/AGENTS.override.md', 'home/.codex/hooks.json',
      'home/.codex/requirements.toml', 'home/.codex/plugins', 'home/.codex/skills'] },
  // 2.1.292 and 2.1.293: credential-free probes verified Lean and Full session-only discovery and
  // host projections. Later 2.1 patches are admitted; every check fails closed on output drift.
  claude: { label: 'Claude', command: 'claude', executableKey: 'claudePath',
    requiredVersion: '2.1.292', versions: ['>=2.1.292 <2.2.0'], parseVersion: output => /^(2\.1\.(0|[1-9]\d*)) \(Claude Code\)$/.exec(output)?.[1] ?? null,
    admits(version) { return /^2\.1\.(0|[1-9]\d*)$/.test(version) && Number(version.split('.')[2]) >= 292; },
    bootstrapPath: 'home/.claude/CLAUDE.md',
    // Provider runtime state (.claude.json, projects, backups, plugin bookkeeping)
    // is not skill discovery state; plugin registration is re-verified on prepare.
    controls: ['plugin', 'project', 'home/.claude/CLAUDE.md', 'home/.claude/settings.json',
      'home/.claude/settings.local.json', 'home/.claude/skills', 'home/.claude/agents', 'home/.claude/commands'] },
});
const providerFor = target => {
  if (!Object.hasOwn(PROVIDERS, target)) throw new Error('Native preparation requires a configured, recovered Codex or Claude managed store');
  return PROVIDERS[target];
};
const exists = file => Boolean(fs.lstatSync(file, { throwIfNoEntry: false }));
const equal = (a, b) => stableStringify(a) === stableStringify(b);
const inside = (a, b) => a === b || a.startsWith(`${b}${path.sep}`);

// Codex rewrites config.toml with project trust bookkeeping at every session
// start, and creates it on first run when it did not exist at preparation.
// Those entries are provider runtime state, not skill discovery state, and the
// carrier never writes config.toml, so readiness compares the config with
// provider bookkeeping keys removed; a missing config, an empty config, and a
// bookkeeping-only config are the same discovery state. Unparseable TOML fails
// closed to raw byte integrity.
const PROVIDER_BOOKKEEPING_KEYS = ['trust', 'projects'];
const PROVIDER_CONFIG_NORMALIZATION = `provider-bookkeeping-keys-ignored:${PROVIDER_BOOKKEEPING_KEYS.join(',')}`;
function providerConfigDigest(bytes) {
  try {
    const doc = TOML.parse(bytes.toString('utf8'));
    for (const key of PROVIDER_BOOKKEEPING_KEYS) delete doc[key];
    return digestObject(doc);
  } catch {
    return io.hash(bytes);
  }
}

function inputs(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Native profile options must be an object');
  for (const key of Object.keys(options)) if (!KEYS.has(key)) throw new Error(`Unknown native profile option: ${key}`);
  const { nativeRoot, stateRoot } = options;
  const providerHomes = [path.join(os.homedir(), '.codex'), process.env.CODEX_HOME,
    path.join(os.homedir(), '.claude'), process.env.CLAUDE_CONFIG_DIR].filter(Boolean);
  if (typeof nativeRoot !== 'string' || !path.isAbsolute(nativeRoot) || path.resolve(nativeRoot) !== nativeRoot
    || nativeRoot === path.parse(nativeRoot).root || nativeRoot === os.homedir() || providerHomes.includes(nativeRoot)) {
    throw new Error('nativeRoot must be an explicit dedicated isolated root');
  }
  if (typeof stateRoot !== 'string' || !path.isAbsolute(stateRoot)) throw new Error('Managed stateRoot is required');
  if (inside(nativeRoot, stateRoot) || inside(stateRoot, nativeRoot)) throw new Error('Native and managed roots must not overlap');
  io.inspect(stateRoot);
  const canonicalState = fs.realpathSync(stateRoot);
  const canonicalNative = exists(nativeRoot) ? fs.realpathSync(nativeRoot)
    : path.join(fs.realpathSync(path.dirname(nativeRoot)), path.basename(nativeRoot));
  const normalized = value => process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
  const forbidden = [os.homedir(), ...providerHomes];
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
  for (const { command, executableKey } of Object.values(PROVIDERS)) {
    const value = options[executableKey];
    if (value !== undefined && (typeof value !== 'string' || (value !== command && !path.isAbsolute(value)))) {
      throw new Error(`${executableKey} must be ${command} or an absolute executable path`);
    }
  }
  io.inspect(nativeRoot, true);
  return { ...options, codexPath: options.codexPath || 'codex', claudePath: options.claudePath || 'claude' };
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
  if (!current.configured || current.recoveryRequired) {
    throw new Error('Native preparation requires a configured, recovered Codex or Claude managed store');
  }
  providerFor(current.target);
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

function snapshot(root, provider) {
  return provider.controls.map(relative => {
    const file = path.join(root, relative);
    if (relative === 'home/.codex/config.toml') {
      // Provider-owned runtime config: compare discovery-relevant state only
      // (see providerConfigDigest); a missing config is the empty state.
      if (!exists(file)) return { path: relative, kind: 'file', digest: digestObject({}), normalization: PROVIDER_CONFIG_NORMALIZATION };
      const bytes = io.read(file);
      return { path: relative, kind: 'file', digest: providerConfigDigest(bytes), normalization: PROVIDER_CONFIG_NORMALIZATION };
    }
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
  // Receipts written before Claude support carry no target and are Codex receipts.
  const target = receipt.target ?? 'codex';
  if (digestObject(receipt) !== state.generationReceiptDigest || receipt.schemaVersion !== 'ecc.native-context-receipt.v1'
    || receipt.generationId !== state.generationId || !Object.hasOwn(PROVIDERS, target)
    || !PROVIDERS[target].admits(receipt.providerVersion)
    || receipt.bindingDigest !== digestObject({ nativeRoot: options.nativeRoot, stateRoot: options.stateRoot })) {
    throw new Error('Native receipt integrity failed');
  }
  const provider = PROVIDERS[target];
  const carrier = io.readJson(path.join(root, 'carrier.json'));
  validateSchema(carrier, 'context-carrier.schema.json');
  const { carrierDigest, ...body } = carrier;
  if (carrierDigest !== receipt.carrierDigest || digestObject(body) !== carrierDigest) throw new Error('Native carrier digest integrity failed');
  if (!equal(snapshot(root, provider), receipt.controls)) throw new Error('Native discovery configuration or skill bytes changed');
  if (!allowRefresh && (!receipt.executable || !equal(fingerprintExecutable(receipt.executable.path), receipt.executable))) {
    throw new Error(`Native ${provider.label} executable changed since preparation`);
  }
  if (receipt.bootstrap) {
    if (receipt.bootstrap.stateRoot !== options.stateRoot || receipt.bootstrap.nativeRoot !== options.nativeRoot
      || receipt.bootstrap.carrierDigest !== receipt.carrierDigest) throw new Error('Interactive root binding integrity failed');
    if (!allowRefresh) require('./context-profile-interactive').verifyBootstrap(receipt.bootstrap);
  }
  return { receipt, carrier, root, target };
}

function providerPaths(target, root) {
  if (target === 'claude') {
    return { codexHome: null, claudeConfigDir: root && path.join(root, 'home/.claude'), pluginDir: root && path.join(root, 'plugin') };
  }
  return { codexHome: root && path.join(root, 'home/.codex') };
}

function response(options, state, current, pending = false, allowRefresh = false) {
  const base = { schemaVersion: 'ecc.native-context-status.v1', nativeRoot: options.nativeRoot,
    stateRoot: options.stateRoot, active: false, ready: false, revision: state?.revision || 0,
    status: pending ? 'recovery-required' : 'unconfigured', target: current.target,
    providerVersion: providerFor(current.target).requiredVersion, home: null, ...providerPaths(current.target, null),
    carrierDigest: null, storeRevision: null,
    currentStoreRevision: current.revision, currentCarrierDigest: current.carrierDigest,
    discovery: 'unobserved', currentSessionChanged: false, credentialsCopied: false };
  if (!state) return base;
  const { receipt, carrier, root, target } = loadReceipt(options, state, { allowRefresh });
  let bindingsMatch = true;
  if (allowRefresh) {
    try {
      bindingsMatch = equal(fingerprintExecutable(receipt.executable.path), receipt.executable);
      if (receipt.bootstrap) require('./context-profile-interactive').verifyBootstrap(receipt.bootstrap);
    } catch { bindingsMatch = false; }
  }
  const matches = state.storeRevision === current.revision && receipt.carrierDigest === current.carrierDigest
    && target === current.target;
  return { ...base, status: pending ? 'recovery-required' : !bindingsMatch ? 'refresh-required' : matches ? 'ready' : 'stale',
    ready: matches && bindingsMatch && !pending, target, providerVersion: receipt.providerVersion, bootstrap: receipt.bootstrap || null,
    home: path.join(root, 'home'), ...providerPaths(target, root),
    carrierDigest: receipt.carrierDigest, storeRevision: state.storeRevision,
    [PROVIDERS[target].executableKey]: receipt.executable.path, executable: receipt.executable.path, executableDigest: receipt.executable.digest,
    ...(receipt.nativeObservation ? { nativeObservation: receipt.nativeObservation } : {}),
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
  const provider = providerFor(current.target);
  return { ...before, status: 'proposed', ready: false, proposedCarrierDigest: current.carrierDigest,
    proposedStoreRevision: current.revision, requiredProviderVersion: provider.requiredVersion,
    supportedProviderVersions: [...provider.versions] };
}

function environment(root, target) {
  const env = { PATH: process.env.PATH, HOME: path.join(root, 'home'), LANG: 'C.UTF-8',
    ...(target === 'claude' ? { CLAUDE_CONFIG_DIR: path.join(root, 'home/.claude'), ...CLAUDE_ISOLATION_ENV }
      : { CODEX_HOME: path.join(root, 'home/.codex') }) };
  if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return env;
}

function command(options, root, args, dependencies) {
  const { label } = providerFor(options.target);
  if (options.executableBinding && !equal(fingerprintExecutable(options.executablePath), options.executableBinding)) {
    throw new Error('Native executable changed before provider call');
  }
  const result = (dependencies.execute || spawnSync)(options.executablePath, args, {
    cwd: path.join(root, 'project'), env: environment(root, options.target), encoding: 'utf8', shell: false,
    timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Native ${label} command failed; isolated attempt retained for recovery`);
  if (typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > 2 * 1024 * 1024) throw new Error(`Native ${label} command output exceeded its bound`);
  return result.stdout.trim();
}

function verifyFiles(directory, carrier) {
  const observed = io.inventory(directory).files.sort((a, b) => a.path.localeCompare(b.path));
  const expected = carrier.files.map(file => ({ path: file.destinationPath, bytes: file.bytes, digest: file.digest }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!equal(observed, expected)) throw new Error('Native installed file set or digest mismatch');
}

function parseJson(text, message) {
  try { return JSON.parse(text); } catch { throw new Error(message); }
}

function componentLine(lines, label) {
  const match = lines.map(line => line.trim()).map(line => new RegExp(`^${label} \\((\\d+)\\)(?:\\s+(.*))?$`).exec(line)).find(Boolean);
  if (!match) throw new Error('Native Claude component discovery mismatch');
  return { count: Number(match[1]), rest: match[2] || '' };
}

// `claude plugin details` has no JSON form; the pinned version fixes this layout.
function parsePluginDetails(text) {
  const lines = text.split(/\r?\n/);
  const skills = componentLine(lines, 'Skills');
  const names = skills.count ? skills.rest.split(',').map(name => name.trim()) : [];
  const counts = ['Agents', 'Hooks', 'MCP servers', 'LSP servers'].map(label => componentLine(lines, label).count);
  const projection = lines.map(line => /^\s*Always-on:\s+~?(\d{1,3}(?:,\d{3})*|\d+)(k?) tok\b/.exec(line)).find(Boolean);
  if (!projection) throw new Error('Native Claude token projection is unparseable');
  const tokens = Number(projection[1].replace(/,/g, '')) * (projection[2] ? 1000 : 1);
  return { skills: names.length === skills.count ? names.sort() : null, extraComponents: counts.some(count => count !== 0), tokens };
}

function verifyClaude(options, root, carrier, dependencies) {
  if (PROVIDERS.claude.parseVersion(command(options, root, ['--version'], dependencies)) !== options.providerVersion) {
    throw new Error('Native Claude version changed since verification');
  }
  const pluginDir = path.join(root, 'plugin');
  const report = parseJson(command(options, root, ['plugin', 'validate', '--json', pluginDir], dependencies), 'Native Claude plugin validation failed');
  if (report?.success !== true || !Array.isArray(report.manifest?.errors) || report.manifest.errors.length
    || !Array.isArray(report.contents) || !report.contents.every(item => Array.isArray(item?.errors) && item.errors.length === 0)) {
    throw new Error('Native Claude plugin validation failed');
  }
  const listed = parseJson(command(options, root, ['--plugin-dir', pluginDir, 'plugin', 'list', '--json'], dependencies),
    'Native Claude plugin discovery mismatch');
  if (!Array.isArray(listed) || listed.length !== 1 || listed[0]?.id !== `${PLUGIN}@inline` || listed[0].scope !== 'session'
    || listed[0].enabled !== true || listed[0].installPath !== pluginDir) throw new Error('Native Claude plugin discovery mismatch');
  const details = parsePluginDetails(command(options, root, ['--plugin-dir', pluginDir, 'plugin', 'details', PLUGIN], dependencies));
  if (details.extraComponents || !equal(details.skills, carrier.entries.map(entry => entry.name).sort())) {
    throw new Error('Native Claude component discovery mismatch');
  }
  verifyFiles(pluginDir, carrier);
  return { surface: 'plugin-always-on-listing', method: `claude-plugin-details@${options.providerVersion}`,
    tokens: details.tokens, approximate: true };
}

function verifyNative(options, root, carrier, dependencies) {
  if (options.target === 'claude') return verifyClaude(options, root, carrier, dependencies);
  if (command(options, root, ['--version'], dependencies) !== `codex-cli ${options.providerVersion}`) throw new Error('Native Codex version changed since verification');
  const env = environment(root, 'codex'); const marketplaceName = `ecc-context-${carrier.carrierDigest.slice(0, 16)}`;
  const cache = path.join(env.CODEX_HOME, 'plugins/cache', marketplaceName, 'ecc-context-carrier/local');
  const result = (dependencies.discover || discoverSync)(options.executablePath, { cwd: path.join(root, 'project'), env });
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
  verifyFiles(cache, carrier);
  return null;
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

function copyCarrier(root, destination, carrier, current) {
  for (const file of carrier.files) {
    const relative = `${destination}/${file.destinationPath}`;
    const bytes = io.read(path.join(current.generationRoot, file.destinationPath));
    if (io.hash(bytes) !== file.digest || bytes.length !== file.bytes) throw new Error('Managed carrier source digest changed');
    io.ensureParents(root, relative); io.writeExclusive(path.join(root, relative), bytes);
  }
}

function providerVersionFor(options, root, dependencies) {
  const provider = providerFor(options.target);
  const version = command(options, root, ['--version'], dependencies);
  const providerVersion = provider.parseVersion(version);
  if (!providerVersion || !provider.admits(providerVersion)) {
    throw new Error(`Native ${provider.label} version must be ${provider.versions.join(' or ')}`);
  }
  return providerVersion;
}

function registerClaude(options, root, carrier, current, dependencies) {
  for (const relative of ['home', 'home/.claude', 'project', 'plugin']) io.mkdir(path.join(root, relative));
  const providerVersion = providerVersionFor(options, root, dependencies);
  copyCarrier(root, 'plugin', carrier, current);
  checkpoint(dependencies, 'registered');
  return { providerVersion, nativeObservation: verifyNative({ ...options, providerVersion }, root, carrier, dependencies) };
}

function register(options, root, carrier, current, dependencies) {
  if (options.target === 'claude') return registerClaude(options, root, carrier, current, dependencies);
  for (const relative of ['home', 'home/.codex', 'project', 'marketplace', 'marketplace/.agents', 'marketplace/.agents/plugins', 'marketplace/carrier']) {
    io.mkdir(path.join(root, relative));
  }
  const providerVersion = providerVersionFor(options, root, dependencies);
  copyCarrier(root, 'marketplace/carrier', carrier, current);
  const name = `ecc-context-${carrier.carrierDigest.slice(0, 16)}`;
  io.writeExclusive(path.join(root, 'marketplace/.agents/plugins/marketplace.json'), io.jsonBytes({ name,
    plugins: [{ name: 'ecc-context-carrier', source: { source: 'local', path: './carrier' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }] }));
  command(options, root, ['plugin', 'marketplace', 'add', path.join(root, 'marketplace'), '--json'], dependencies);
  command(options, root, ['plugin', 'add', `ecc-context-carrier@${name}`, '--json'], dependencies);
  checkpoint(dependencies, 'registered');
  verifyNative({ ...options, providerVersion }, root, carrier, dependencies);
  return { providerVersion, nativeObservation: null };
}

function prepareNativeProfile(input, dependencies = {}) {
  let options = inputs(input); const current = currentStore(options);
  previewNativeProfile(options);
  const provider = providerFor(current.target);
  const executable = resolveExecutable(options[provider.executableKey], provider.command);
  owner(options, true);
  options = { ...options, target: current.target, executablePath: executable.path, executableBinding: executable };
  return locked(options, false, () => {
    if (exists(path.join(options.nativeRoot, 'pending.json'))) throw new Error('Native attempt requires recovery');
    const before = readState(options);
    if (options.expectedRevision !== undefined && options.expectedRevision !== (before?.revision || 0)) throw new Error('Native revision changed since preview');
    const previous = before ? loadReceipt(options, before, { allowRefresh: true }) : null;
    const bootstrap = require('./context-profile-interactive').bootstrapFor(options, current);
    if (before && before.storeRevision === current.revision && previous.target === current.target) {
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
    const { providerVersion, nativeObservation } = register(options, root, carrier, current, dependencies);
    io.writeExclusive(path.join(root, provider.bootstrapPath), bootstrap.bytes);
    const receipt = { schemaVersion: 'ecc.native-context-receipt.v1', generationId,
      bindingDigest: digestObject({ nativeRoot: options.nativeRoot, stateRoot: options.stateRoot }),
      ...(current.target === 'codex' ? {} : { target: current.target }),
      carrierDigest: carrier.carrierDigest, providerVersion, executable, bootstrap: bootstrap.binding,
      ...(nativeObservation ? { nativeObservation } : {}), controls: snapshot(root, provider) };
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
    if (receipt.carrierDigest !== current.carrierDigest || previous.target !== current.target) {
      throw new Error('Rollback the managed store to the previous native carrier first');
    }
    verifyNative({ ...options, target: previous.target, providerVersion: receipt.providerVersion,
      executablePath: receipt.executable.path, executableBinding: receipt.executable }, root, previous.carrier, dependencies);
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

module.exports = { CLAUDE_ISOLATION_ENV, getNativeProfileStatus, prepareNativeProfile, previewNativeProfile,
  recoverNativeProfile, rollbackNativeProfile };
