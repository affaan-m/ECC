'use strict';

// Development-only evaluator. It lives under docker/ so the npm package never ships it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const LIB = path.join(__dirname, '../../scripts/lib');
const { loadContextRegistry } = require(path.join(LIB, 'context-pack-registry'));
const { compileContextProfile } = require(path.join(LIB, 'context-profiles'));
const { resolveTaskContext, resolveDeclinedFallback } = require(path.join(LIB, 'context-selection'));
const { proposeTaskContext } = require(path.join(LIB, 'context-profile-proposal'));
const { resolveExecutable, fingerprintExecutable } = require(path.join(LIB, 'context-profile-native-executable'));
const { launchTaskContext } = require(path.join(LIB, 'context-profile-launch'));
const { applyStore } = require(path.join(LIB, 'context-profile-store'));
const { prepareNativeProfile, getNativeProfileStatus } = require(path.join(LIB, 'context-profile-native'));
const { DEFAULT_REPO_ROOT, digestObject, createSourceReader } = require(path.join(LIB, 'context-profile-support'));
const io = require(path.join(LIB, 'context-profile-store-fs'));

const ARMS = Object.freeze(['full', 'manual-lean', 'auto-lean', 'ecc-legacy', 'baseline']);
const CORPUS_PATH = path.join(__dirname, 'ai-corpus.json');
const LEGACY_PIN_PATH = path.join(__dirname, 'legacy-source.json');
const CHECK_FILE = '.ecc-eval-check.cjs';
const IMPLEMENTATION = ['docker/context-profiles/ai-eval-lib.js', 'docker/context-profiles/ai-eval.js',
  'docker/context-profiles/legacy-source.json',
  'manifests/context-packs/skill-triggers@1.json',
  'scripts/lib/context-profile-launch.js', 'scripts/lib/context-selection.js',
  'scripts/lib/context-profile-proposal.js', 'scripts/lib/context-profiles.js',
  'scripts/lib/context-profile-support.js', 'scripts/lib/context-pack-registry.js',
  'scripts/lib/context-profile-native-executable.js', 'scripts/lib/context-profile-native.js',
  'scripts/lib/context-profile-store.js', 'scripts/lib/context-profile-store-fs.js'];
const BLOCKS = Object.freeze({ excluded: /Context ID is excluded:/,
  'native-authority': /requires native authority or dynamic-content review/,
  'manual-only': /Context ID is manual-only:/, 'opt-out-conflict': /noWorkflow conflicts/, 'unknown-id': /Unknown context ID:/ });
const ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'CODEX_HOME', 'TMPDIR', 'LANG', 'SystemRoot'];
const CLAUDE_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'TMPDIR', 'LANG', 'SystemRoot'];
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const exists = file => Boolean(fs.lstatSync(file, { throwIfNoEntry: false }));

function loadCorpus(file = CORPUS_PATH) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function safeRelative(file) {
  return typeof file === 'string' && file.length > 0 && file.length <= 200 && !path.isAbsolute(file)
    && !file.startsWith('.') && !file.includes('\\') && file.split('/').every(part => part && part !== '..' && part !== '.');
}

function validateCorpus(corpus) {
  if (corpus?.schemaVersion === 'ecc.context-eval-complex-corpus.v1') return validateComplexCorpus(corpus);
  if (corpus?.schemaVersion !== 'ecc.context-eval-corpus.v2'
    || !Array.isArray(corpus.selection) || !Array.isArray(corpus.tasks)
    || !bounded(corpus.selection.length, 1, 200) || !bounded(corpus.tasks.length, 1, 200)
    || corpus.minimumDistinctTasks !== 30 || corpus.nonInferiorityMargin !== 0.05) {
    throw new Error('Invalid preregistered corpus');
  }
  for (const cases of [corpus.selection, corpus.tasks]) validateCorpusIds(cases);
  for (const task of corpus.tasks) {
    const files = Object.entries(task.files || {});
    if (!Array.isArray(task.manualIds) || task.manualIds.length > 1 || !bounded(files.length, 1, 8)
      || files.some(([file, content]) => !safeRelative(file) || typeof content !== 'string' || Buffer.byteLength(content) > 16384)
      || typeof task.check !== 'string' || !bounded(Buffer.byteLength(task.check), 1, 16384)) {
      throw new Error('Invalid corpus task');
    }
  }
}

function validateCorpusIds(cases) {
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Duplicate corpus ID');
  for (const item of cases) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || typeof item.query !== 'string'
      || !bounded(Buffer.byteLength(item.query), 1, 8192)) throw new Error('Invalid corpus case');
  }
}

// Complex corpora hold a few realistic multi-file tasks with scored hidden graders. Sample gates
// are descriptive at this size, so the distinct-task minimum relaxes to the corpus itself.
function validateComplexCorpus(corpus) {
  if (!Array.isArray(corpus.selection) || !Array.isArray(corpus.tasks)
    || !bounded(corpus.selection.length, 0, 50) || !bounded(corpus.tasks.length, 1, 10)
    || corpus.minimumDistinctTasks !== corpus.tasks.length || corpus.nonInferiorityMargin !== 0.05) {
    throw new Error('Invalid preregistered corpus');
  }
  for (const cases of [corpus.selection, corpus.tasks]) validateCorpusIds(cases);
  for (const task of corpus.tasks) {
    const files = Object.entries(task.files || {});
    if (!Array.isArray(task.manualIds) || task.manualIds.length > 3 || !bounded(files.length, 1, 24)
      || files.some(([file, content]) => !safeRelative(file) || typeof content !== 'string' || Buffer.byteLength(content) > 65536)
      || typeof task.check !== 'string' || !bounded(Buffer.byteLength(task.check), 1, 65536)
      || (task.checkTimeoutMs !== undefined && !bounded(task.checkTimeoutMs, 1, 120000))) {
      throw new Error('Invalid corpus task');
    }
  }
}

function sourceSnapshot(repoRoot) {
  const registry = loadContextRegistry({ repoRoot });
  const profiles = ['full@1', 'lean@1'].map(profileId => compileContextProfile({ repoRoot, profileId }));
  const reader = createSourceReader(DEFAULT_REPO_ROOT);
  const implementation = IMPLEMENTATION.map(file => ({ path: file, digest: reader.read(file).digest }));
  const packageJson = JSON.parse(reader.read('package.json').content.toString('utf8'));
  const runtime = { node: process.versions.node, dependencies: {
    ajv: packageJson.dependencies.ajv, 'js-yaml': packageJson.dependencies['js-yaml'] } };
  return { registry, profiles, sourceDigest: digestObject({ registryDigest: registry.registryDigest,
    planDigests: profiles.map(p => p.planDigest), implementation, runtime }), runtime };
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

function providerFamily(executable) {
  const base = path.basename(String(executable || '')).toLowerCase();
  if (base.includes('claude')) return 'claude';
  if (base.includes('codex')) return 'codex';
  throw new Error('Provider executable must name a Claude or Codex CLI');
}

function resolveFamily(provider, executable) {
  if (provider !== undefined && provider !== null) {
    if (!['claude', 'codex'].includes(provider)) throw new Error('Provider must be claude or codex');
    return provider;
  }
  if (executable) return providerFamily(executable);
  return 'codex';
}

function providerPin(model, executable, effort) {
  if (model === undefined && executable === undefined && effort === undefined) return null;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(model)
    || !path.isAbsolute(executable || '')) throw new Error('Provider pin requires model and absolute executable');
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new Error('Invalid reasoning effort');
  return { modelDigest: digestObject(model), executableDigest: resolveExecutable(executable).digest,
    ...(effort === undefined ? {} : { effort }) };
}

function preregister({ repoRoot = DEFAULT_REPO_ROOT, corpus = loadCorpus(), repeats = 1, model, executable, effort } = {}) {
  validateCorpus(corpus);
  if (!bounded(repeats, 1, 20)) throw new Error('Invalid repeat count');
  const source = sourceSnapshot(repoRoot);
  const value = { schemaVersion: 'ecc.context-eval-registration.v2', corpusDigest: digestObject(corpus),
    sourceDigest: source.sourceDigest, registryDigest: source.registry.registryDigest,
    providerPin: providerPin(model, executable, effort), runtime: source.runtime,
    arms: [...ARMS], repeats, minimumDistinctTasks: corpus.minimumDistinctTasks, nonInferiorityMargin: 0.05,
    confidence: 0.95, sampling: 'fixed-purposive-pilot',
    design: corpus.schemaVersion === 'ecc.context-eval-complex-corpus.v1'
      ? 'paired-native-installs-hidden-scored-complex-tasks'
      : 'paired-native-installs-hidden-graded-coding-tasks',
    order: corpus.tasks.flatMap((task, index) => Array.from({ length: repeats }, (_, repeat) => ({
      id: task.id, repeat, arms: ARMS.map((_, offset) => ARMS[(index + repeat + offset) % ARMS.length]),
    }))), selectionIds: corpus.selection.map(c => c.id) };
  return { ...value, registrationDigest: digestObject(value) };
}

// Parse in memory only. No event objects, paths, provider messages or error text enter reports.
function parseCodexJsonl(stdout) {
  const invalid = { valid: false, text: '', usage: null };
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 1024 * 1024) return invalid;
  let text = '';
  let completions = 0;
  let usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  try {
    for (const line of stdout.split('\n').filter(line => line.trim())) {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || ['error', 'turn.failed'].includes(event.type)) return invalid;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        if (typeof event.item.text !== 'string') return invalid;
        text = event.item.text;
      }
      if (event.type !== 'turn.completed') continue;
      const u = event.usage;
      if (!u || ![u.input_tokens, u.cached_input_tokens, u.output_tokens].every(v => bounded(v, 0, 1e9))
        || u.cached_input_tokens > u.input_tokens) return invalid;
      completions++;
      usage = { inputTokens: usage.inputTokens + u.input_tokens,
        cachedInputTokens: usage.cachedInputTokens + u.cached_input_tokens,
        outputTokens: usage.outputTokens + u.output_tokens };
    }
  } catch { return invalid; }
  return completions === 1 ? { valid: true, text, usage } : invalid;
}

// Claude print-mode emits exactly one result JSON object. Fresh input folds cache creations;
// cache reads are reported separately. is_error results are provider failures, not parse failures.
function parseClaudeJson(stdout) {
  const invalid = { valid: false, text: '', usage: null };
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 1024 * 1024) return invalid;
  let result = null;
  let results = 0;
  try {
    for (const line of stdout.split('\n').filter(line => line.trim())) {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || Array.isArray(event)) return invalid;
      if (event.type !== 'result') continue;
      results++;
      result = event;
    }
  } catch { return invalid; }
  if (results !== 1) return invalid;
  if (result.is_error !== false || typeof result.result !== 'string') return { ...invalid, error: true };
  const u = result.usage;
  if (!u || ![u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens, u.output_tokens]
    .every(value => bounded(value, 0, 1e9))) return { ...invalid, error: true };
  return { valid: true, text: result.result,
    usage: { inputTokens: u.input_tokens + u.cache_creation_input_tokens,
      cachedInputTokens: u.cache_read_input_tokens, outputTokens: u.output_tokens } };
}

function privateEntry(file, directory) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  return Boolean(stat) && !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile())
    && (process.platform === 'win32' || ((stat.mode & 0o077) === 0 && (!process.getuid || stat.uid === process.getuid())));
}

/**
 * Subscription credentials stay in a dedicated evaluator login home. Each call leases auth.json into the
 * isolated CODEX_HOME, returns refreshed tokens afterwards and always removes the leased copy.
 */
function createAuthLease(authHome) {
  if (typeof authHome !== 'string' || !path.isAbsolute(authHome)) throw new Error('Auth home must be an absolute path');
  const real = fs.realpathSync(authHome);
  const forbidden = [path.join(os.homedir(), '.codex'), process.env.CODEX_HOME].filter(Boolean)
    .map(file => (exists(file) ? fs.realpathSync(file) : path.resolve(file)));
  if (forbidden.includes(real)) throw new Error('Auth home must be a dedicated evaluator login home, not your Codex home');
  const source = path.join(real, 'auth.json');
  if (!privateEntry(real, true) || !privateEntry(source, false)) {
    throw new Error('Auth home must be a private directory containing a private auth.json; see the evaluation guide');
  }
  return {
    mode: 'subscription-lease',
    run(codexHome, work) {
      const leased = path.join(codexHome, 'auth.json');
      const original = fs.readFileSync(source);
      fs.writeFileSync(leased, original, { flag: 'wx', mode: 0o600 });
      try { return work(); } finally {
        try {
          const after = fs.readFileSync(leased);
          if (!after.equals(original)) {
            JSON.parse(after.toString('utf8'));
            const temp = `${source}.${process.pid}.tmp`;
            fs.writeFileSync(temp, after, { flag: 'wx', mode: 0o600 });
            fs.renameSync(temp, source);
          }
        } catch { /* An unreadable refresh keeps the previous login; the next call reports any auth failure. */ }
        fs.rmSync(leased, { force: true });
      }
    },
  };
}

/**
 * Claude subscription logins live in the macOS Keychain as a JSON wrapper. The lease reads the
 * current access token per call into the child environment only; it is never persisted or reported.
 */
function readClaudeKeychainToken() {
  if (process.platform !== 'darwin') throw new Error('Claude Keychain login requires macOS; provide CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY');
  const result = spawnSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
    { encoding: 'utf8', shell: false, timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 65536 });
  if (result.status !== 0 || result.error) throw new Error('Claude Keychain login is unavailable; provide CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY');
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch { throw new Error('Claude Keychain login is unreadable; provide CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY'); }
  const token = parsed?.claudeAiOauth?.accessToken;
  if (typeof token !== 'string' || !token) throw new Error('Claude Keychain login is unrecognized; provide CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY');
  return token;
}

function createClaudeProvider({ allowRealProvider = false, executable, model,
  apiKey = process.env.ANTHROPIC_API_KEY, oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN,
  tokenSource = readClaudeKeychainToken, persistSessions = false, execute = spawnSync } = {}) {
  if (allowRealProvider !== true) throw new Error('Real provider requires explicit opt-in');
  if (!model || !executable) throw new Error('Real provider requires a model and absolute executable');
  let lease = null;
  let authentication;
  if (oauthToken) authentication = 'oauth-env';
  else if (apiKey) authentication = 'api-key';
  else if (typeof tokenSource === 'function') {
    lease = { mode: 'subscription-keychain-lease',
      run(env, work) { env.CLAUDE_CODE_OAUTH_TOKEN = tokenSource(); return work(); } };
    authentication = lease.mode;
  } else throw new Error('Real provider requires CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, or the Claude Keychain login');
  const pin = providerPin(model, executable, undefined);
  const binary = resolveExecutable(executable);
  const provider = request => {
    if (fingerprintExecutable(binary.path).digest !== pin.executableDigest) fail('source-drift');
    const selection = request.phase === 'selection';
    // Selection is tool-free and read-only; task execution may edit and run commands in the workspace.
    // Claude has no cwd-write sandbox flag, so containment relies on the isolated home and temp workspace.
    const args = ['--print', '--output-format', 'json',
      ...(persistSessions ? [] : ['--no-session-persistence']),
      ...(selection ? ['--tools', ''] : ['--permission-mode', 'bypassPermissions']),
      '--model', model];
    const env = Object.fromEntries(CLAUDE_ENV_KEYS.filter(key => typeof request.env?.[key] === 'string')
      .map(key => [key, request.env[key]]));
    env.DISABLE_NON_ESSENTIAL_MODEL_CALLS = '1';
    if (authentication === 'oauth-env') env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    if (authentication === 'api-key') env.ANTHROPIC_API_KEY = apiKey;
    const call = () => execute(binary.path, args, { input: request.input, cwd: request.cwd, env,
      encoding: 'utf8', shell: false, timeout: request.timeoutMs, killSignal: 'SIGKILL',
      maxBuffer: request.maxBuffer });
    return lease ? lease.run(env, call) : call();
  };
  provider.authentication = authentication;
  return provider;
}

function createCodexProvider({ allowRealProvider = false, executable, model, effort, authHome,
  apiKey = process.env.CODEX_API_KEY, execute = spawnSync } = {}) {
  if (allowRealProvider !== true) throw new Error('Real provider requires explicit opt-in');
  if (!model || !executable) throw new Error('Real provider requires a model and absolute executable');
  if (!authHome && !apiKey) throw new Error('Real provider requires --auth-home (subscription login) or CODEX_API_KEY');
  const lease = authHome ? createAuthLease(authHome) : null;
  const pin = providerPin(model, executable, effort);
  const binary = resolveExecutable(executable);
  const provider = request => {
    if (fingerprintExecutable(binary.path).digest !== pin.executableDigest) fail('source-drift');
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check',
      '--sandbox', request.phase === 'selection' ? 'read-only' : 'workspace-write',
      // Connected ChatGPT apps and account plugin installs stay out of every arm.
      '--disable', 'apps', '--disable', 'remote_plugin',
      '-c', 'approval_policy="never"', ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
      '--model', model, '-'];
    const env = Object.fromEntries(ENV_KEYS.filter(key => typeof request.env?.[key] === 'string')
      .map(key => [key, request.env[key]]));
    if (!lease) env.CODEX_API_KEY = apiKey;
    const call = () => execute(binary.path, args, { input: request.input, cwd: request.cwd, env,
      encoding: 'utf8', shell: false, timeout: request.timeoutMs, killSignal: 'SIGKILL',
      maxBuffer: request.maxBuffer });
    return lease ? lease.run(env.CODEX_HOME, call) : call();
  };
  provider.authentication = lease ? lease.mode : 'api-key';
  return provider;
}

/** Real Lean and Full installs, prepared through the same isolated native adapter users get. */
function prepareEnvironments({ repoRoot, executable, root }) {
  throw new Error('The ecc-legacy arm requires the Claude provider; Codex native installs are not prepared here');
  const binary = resolveExecutable(executable);
  const environments = {};
  for (const [name, profileId, selectionMode] of [['full', 'full@1', 'manual'], ['lean', 'lean@1', 'auto']]) {
    const options = { stateRoot: path.join(root, name, 'managed'), nativeRoot: path.join(root, name, 'native') };
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
    applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'codex', selectionMode, profileId });
    const status = prepareNativeProfile({ ...options, codexPath: executable });
    if (!status.ready) throw new Error(`Native ${name} install is not ready`);
    // A signed-in Codex records task-directory trust in config.toml and downloads account-provided
    // plugins into plugins/. Restoring the prepared state after every call keeps trials identical;
    // any other change still fails verification as drift.
    const config = path.join(status.codexHome, 'config.toml');
    const prepared = fs.readFileSync(config);
    const plugins = path.join(status.codexHome, 'plugins');
    const listing = directory => (exists(directory) ? fs.readdirSync(directory) : []);
    const preparedPlugins = new Set(listing(plugins));
    const preparedCache = new Set(listing(path.join(plugins, 'cache')));
    environments[name] = { profileId, skills: status.selectedIds.length,
      launch: { home: status.home, codexHome: status.codexHome, codexPath: status.codexPath,
        executableDigest: status.executableDigest },
      restore() {
        fs.writeFileSync(config, prepared);
        for (const entry of listing(plugins)) if (!preparedPlugins.has(entry)) fs.rmSync(path.join(plugins, entry), { recursive: true, force: true });
        for (const entry of listing(path.join(plugins, 'cache'))) {
          if (!preparedCache.has(entry)) fs.rmSync(path.join(plugins, 'cache', entry), { recursive: true, force: true });
        }
      },
      verify() {
        let ready = false;
        try { ready = getNativeProfileStatus(options).ready; } catch { ready = false; }
        if (!ready) fail('environment-drift');
      } };
  }
  // Baseline arm: an empty native home with no ECC install, for provider-overhead subtraction.
  const home = path.join(root, 'baseline', 'home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true, mode: 0o700 });
  environments.baseline = { profileId: null, skills: 0, restore() {},
    launch: { home, codexHome: path.join(home, '.codex'), codexPath: binary.path, executableDigest: binary.digest },
    verify() { if (fingerprintExecutable(binary.path).digest !== binary.digest) fail('environment-drift'); } };
  return environments;
}

function installClaudeSkills({ payload, home }) {
  const config = path.join(home, '.claude');
  const installed = path.join(config, 'skills');
  fs.mkdirSync(installed, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(payload)) {
    fs.cpSync(path.join(payload, entry), path.join(installed, entry), { recursive: true, errorOnExist: true, force: false });
  }
  return { config, installed };
}

function claudeEnvironment({ name, binary, home, config, installed, profileId, skills, sourceSha = null }) {
  const managed = () => digestObject(io.inventory(installed));
  const prepared = managed();
  return [name, { profileId, skills, sourceSha,
    launch: { home, claudeConfigDir: config, claudePath: binary.path, executableDigest: binary.digest },
    restore() {},
    verify() {
      if (fingerprintExecutable(binary.path).digest !== binary.digest) fail('environment-drift');
      let observed = null;
      try { observed = managed(); } catch { observed = null; }
      if (observed !== prepared) fail('environment-drift');
    } }];
}

/** The pre-scoping ECC source, pinned by commit so the ecc-legacy arm is reproducible. */
function exportLegacySource({ repoRoot = DEFAULT_REPO_ROOT, destination,
  pin = JSON.parse(fs.readFileSync(LEGACY_PIN_PATH, 'utf8')) } = {}) {
  if (!/^[a-f0-9]{40}$/.test(pin?.sha || '')) throw new Error('Invalid legacy source pin');
  if (!path.isAbsolute(destination || '')) throw new Error('Legacy destination must be absolute');
  const resolved = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--verify', `${pin.sha}^{commit}`],
    { encoding: 'utf8', shell: false, timeout: 30000, killSignal: 'SIGKILL' });
  if (resolved.status !== 0 || resolved.error || resolved.stdout.trim() !== pin.sha) {
    throw new Error('Legacy source pin is unavailable in this repository');
  }
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const tar = path.join(destination, 'legacy.tar');
  const archive = spawnSync('git', ['-C', repoRoot, 'archive', '--format=tar', '-o', tar, pin.sha, 'skills'],
    { encoding: 'utf8', shell: false, timeout: 60000, killSignal: 'SIGKILL' });
  const extract = archive.status === 0 && !archive.error
    ? spawnSync('tar', ['-xf', tar, '-C', destination], { encoding: 'utf8', shell: false, timeout: 60000, killSignal: 'SIGKILL' })
    : archive;
  fs.rmSync(tar, { force: true });
  const payload = path.join(destination, 'skills');
  if (extract.status !== 0 || extract.error || !exists(payload) || !fs.readdirSync(payload).length) {
    throw new Error('Legacy source export failed');
  }
  return { root: destination, sha: pin.sha };
}

/** Real Claude installs in isolated config homes. Managed-skill drift aborts; there is no
 * provider bookkeeping to restore because isolated Claude runs do not mutate the managed tree. */
function prepareClaudeEnvironments({ repoRoot, executable, root, legacySource = null }) {
  const binary = resolveExecutable(executable);
  const environments = {};
  for (const [name, profileId, selectionMode] of [['full', 'full@1', 'manual'], ['lean', 'lean@1', 'auto']]) {
    const stateRoot = path.join(root, name, 'managed');
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
    const status = applyStore({ repoRoot, stateRoot, target: 'claude', selectionMode, profileId });
    const home = path.join(root, name, 'home');
    const { config, installed } = installClaudeSkills({ payload: path.join(status.generationRoot, 'skills'), home });
    const [key, env] = claudeEnvironment({ name, binary, home, config, installed, profileId, skills: status.selectedIds.length });
    environments[key] = env;
  }
  if (legacySource) {
    // ecc-legacy: the typical pre-scoping install — the full skill library from the pinned
    // pre-ECC-029 commit, launched bare with no ECC context block.
    const home = path.join(root, 'ecc-legacy', 'home');
    const { config, installed } = installClaudeSkills({ payload: path.join(legacySource.root, 'skills'), home });
    const [key, env] = claudeEnvironment({ name: 'ecc-legacy', binary, home, config, installed,
      profileId: null, skills: fs.readdirSync(installed).length, sourceSha: legacySource.sha });
    environments[key] = env;
  }
  // Baseline arm: an empty config home with no ECC install, for provider-overhead subtraction.
  const baselineHome = path.join(root, 'baseline', 'home');
  const baselineConfig = path.join(baselineHome, '.claude');
  fs.mkdirSync(baselineConfig, { recursive: true, mode: 0o700 });
  environments.baseline = { profileId: null, skills: 0, sourceSha: null, restore() {},
    launch: { home: baselineHome, claudeConfigDir: baselineConfig, claudePath: binary.path, executableDigest: binary.digest },
    verify() { if (fingerprintExecutable(binary.path).digest !== binary.digest) fail('environment-drift'); } };
  return environments;
}

function syntheticEnvironments(root) {
  const executable = resolveExecutable(process.execPath);
  return Object.fromEntries(['full', 'lean', 'ecc-legacy', 'baseline'].map(name => {
    const home = path.join(root, name, 'home');
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true, mode: 0o700 });
    return [name, { profileId: ['baseline', 'ecc-legacy'].includes(name) ? null : `${name}@1`, skills: null, sourceSha: null,
      verify() {}, restore() {},
      launch: { home, codexHome: path.join(home, '.codex'), codexPath: executable.path, executableDigest: executable.digest } }];
  }));
}

function checkArguments(cwd) {
  const major = Number(process.versions.node.split('.')[0]);
  const flag = major >= 22 ? '--permission' : major >= 20 ? '--experimental-permission' : null;
  return flag ? [flag, `--allow-fs-read=${cwd}`, `--allow-fs-read=${path.join(cwd, '*')}`, CHECK_FILE] : [CHECK_FILE];
}

// The hidden grader enters the workspace only after the agent exits, and runs read-only where Node supports it.
// A grader may print one `ECC_EVAL_SCORE {"score":0..1}` line for partial credit; without it the exit
// status alone decides (exit 0 scores 1). Outcome success still requires a full score.
const SCORE_LINE = /^\s*ECC_EVAL_SCORE\s+(\{[^\n]*\})\s*$/m;
function runScoredCheck(cwd, source, timeoutMs = 10000) {
  const file = path.join(cwd, CHECK_FILE);
  if (exists(file)) return { passed: false, score: 0 };
  fs.writeFileSync(file, source, { flag: 'wx' });
  const result = spawnSync(process.execPath, checkArguments(fs.realpathSync(cwd)), { cwd, encoding: 'utf8',
    env: { LANG: 'C.UTF-8' }, shell: false, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 65536 });
  const passed = result.status === 0 && !result.error;
  let score = passed ? 1 : 0;
  const match = SCORE_LINE.exec(result.stdout || '');
  if (passed && match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (typeof parsed?.score === 'number' && parsed.score >= 0 && parsed.score <= 1) score = parsed.score;
    } catch { /* A malformed score line keeps the exit-status score. */ }
  }
  return { passed, score };
}

function runCheck(cwd, source) { return runScoredCheck(cwd, source).passed; }

function writeWorkspace(cwd, files) {
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(cwd, relative)), { recursive: true });
    fs.writeFileSync(path.join(cwd, relative), content, { flag: 'wx' });
  }
}

function wilson(successes, n) {
  if (!n) return [0, 1];
  const z = 1.959963984540054;
  const p = successes / n;
  const denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

function summarize(outcomes) {
  const ids = [...new Set(outcomes.map(row => row.id))];
  const rates = ARMS.map(arm => {
    const rows = outcomes.filter(row => row.arm === arm);
    return { arm, attempts: rows.length, successes: rows.filter(row => row.passed).length,
      rate: rows.length ? rows.filter(row => row.passed).length / rows.length : null,
      meanScore: rows.length ? rows.reduce((sum, row) => sum + (typeof row.score === 'number' ? row.score : Number(row.passed)), 0) / rows.length : null };
  });
  const pairs = ARMS.slice(1).map(arm => {
    const differences = ids.map(id => {
      const rows = outcomes.filter(row => row.id === id);
      const baseline = rows.filter(row => row.arm === 'full');
      const delta = baseline.map(row => Number(rows.find(r => r.arm === arm && r.repeat === row.repeat)?.passed === true)
        - Number(row.passed === true));
      return delta.length ? delta.reduce((a, b) => a + b, 0) / delta.length : null;
    }).filter(value => value !== null);
    const n = differences.length;
    const delta = n ? differences.reduce((a, b) => a + b, 0) / n : null;
    // Paired task-cluster means in [-1,1]. Hoeffding with Bonferroni for four comparisons.
    const radius = n ? Math.sqrt(2 * Math.log(80) / n) : 2;
    return { arm, n, delta, interval: [Math.max(-1, (delta || 0) - radius), Math.min(1, (delta || 0) + radius)],
      method: 'paired-task-cluster-hoeffding-familywise-95' };
  });
  return { distinctTasks: ids.length, rates, pairs };
}

function selectionTask(item) {
  return { sessionId: 'ecc-eval', taskId: item.id, revision: 1, phase: 'evaluate', query: item.query,
    ...(item.noWorkflow === undefined ? {} : { noWorkflow: item.noWorkflow }),
    ...(item.explicitIds ? { explicitIds: item.explicitIds } : {}) };
}

function failureCode(error) {
  if (['call-budget', 'deadline', 'source-drift', 'environment-drift', 'provider-failed', 'invalid-jsonl'].includes(error?.code)) return error.code;
  for (const [code, pattern] of Object.entries(BLOCKS)) if (pattern.test(error?.message || '')) return code;
  return 'evaluation-failed';
}
function fail(code) { const error = new Error(code); error.code = code; throw error; }

function launchEnvironment(launch) {
  return { PATH: process.env.PATH, HOME: launch.home,
    ...(launch.codexHome ? { CODEX_HOME: launch.codexHome } : {}),
    ...(launch.claudeConfigDir ? { CLAUDE_CONFIG_DIR: launch.claudeConfigDir } : {}),
    TMPDIR: launch.home, LANG: 'C.UTF-8' };
}

function executeAdapter(state, cwd, environment) {
  return (_command, args, options) => {
    if (state.calls >= state.maxCalls) fail('call-budget');
    state.assertCurrent();
    environment.verify();
    const remaining = state.deadline - Date.now();
    if (remaining <= 0) fail('deadline');
    const phase = options.phase || (args.includes('read-only') ? 'selection' : 'task');
    state.calls++;
    const started = Date.now();
    let raw;
    // Coding tasks outgrow the launcher's interactive default, so the evaluator's own call bound governs them.
    const timeoutMs = Math.min(phase === 'task' ? state.callTimeoutMs : options.timeout, state.callTimeoutMs, remaining);
    const env = options.env || launchEnvironment(environment.launch);
    try {
      raw = state.provider({ phase, input: options.input, cwd, env, timeoutMs, maxBuffer: 1024 * 1024 });
    } catch (error) {
      state.metrics.push({ phase, elapsedMs: Date.now() - started, usage: null });
      if (error?.code === 'source-drift') throw error;
      fail('provider-failed');
    } finally { environment.restore(); }
    const elapsedMs = Date.now() - started;
    const parsed = state.family === 'claude' ? parseClaudeJson(raw?.stdout) : parseCodexJsonl(raw?.stdout);
    state.metrics.push({ phase, elapsedMs, usage: parsed.valid && raw?.status === 0 && !raw?.error ? parsed.usage : null });
    if (Date.now() >= state.deadline || elapsedMs > timeoutMs) fail('deadline');
    state.assertCurrent();
    if (raw?.status !== 0 || raw?.error) fail('provider-failed');
    if (!parsed.valid) fail(parsed.error ? 'provider-failed' : 'invalid-jsonl');
    return { status: 0, stdout: parsed.text };
  };
}

function selectionProbe(item, repoRoot, execute, environment, target) {
  const options = { repoRoot, task: selectionTask(item), exclude: item.exclude || [], load: true };
  try {
    let selection = resolveTaskContext(options);
    if (selection.reason === 'agent-selection-required') {
      const proposedIds = proposeTaskContext({ target, query: item.query, candidates: selection.candidates, execute,
        executable: environment.launch.codexPath || environment.launch.claudePath });
      const next = resolveTaskContext({ ...options, task: { ...options.task, proposedIds, noWorkflow: proposedIds.length === 0 } });
      selection = next.selectedIds.length ? next : resolveDeclinedFallback(options, selection);
    }
    return { id: item.id, category: item.category, passed: !item.expectedBlock
      && isDeepStrictEqual(selection.selectedIds, item.expectedIds), selectedIds: selection.selectedIds, failure: null };
  } catch (error) {
    const failure = failureCode(error);
    return { id: item.id, category: item.category, passed: Boolean(item.expectedBlock && failure === item.expectedBlock),
      selectedIds: [], failure };
  }
}

// Full relies on native discovery of the whole install; the Lean arms receive ECC-selected skill bodies;
// ecc-legacy runs bare against the pinned pre-scoping skill library; Baseline runs the bare task query.
function outcomeTrial(item, arm, repeat, repoRoot, execute, cwd, environment, target, harvest) {
  try {
    const task = selectionTask(item);
    const result = launchTaskContext({ repoRoot, execute, nativeEnvironment: environment.launch, target,
      bare: arm === 'baseline' || arm === 'ecc-legacy',
      task: { ...task, ...(arm === 'manual-lean' && item.manualIds.length ? { explicitIds: item.manualIds } : {}) },
      profileId: arm === 'full' ? 'full@1' : 'lean@1', selectionMode: arm === 'auto-lean' ? 'auto' : 'manual' });
    if (harvest) harvest(arm, item.id, repeat, environment);
    const verdict = runScoredCheck(cwd, item.check, item.checkTimeoutMs);
    const passed = result.status === 'completed' && verdict.passed && verdict.score >= 0.999;
    return { id: item.id, arm, repeat, passed, score: result.status === 'completed' ? verdict.score : 0,
      selectedIds: result.selection.selectedIds, failure: passed ? null : 'hidden-check' };
  } catch (error) {
    if (harvest) harvest(arm, item.id, repeat, environment);
    return { id: item.id, arm, repeat, passed: false, score: 0, selectedIds: [], failure: failureCode(error) };
  }
}

function metricsSince(metrics, start) {
  const calls = metrics.slice(start);
  const complete = calls.length > 0 && calls.every(call => call.usage !== null);
  return { calls: calls.length, elapsedMs: calls.reduce((sum, c) => sum + c.elapsedMs, 0),
    usage: complete ? calls.reduce((sum, c) => ({ inputTokens: sum.inputTokens + c.usage.inputTokens,
      cachedInputTokens: sum.cachedInputTokens + c.usage.cachedInputTokens,
      outputTokens: sum.outputTokens + c.usage.outputTokens }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }) : null };
}

// Transcript retention is opt-in (--artifact-dir) and file-only: reports never embed session content or paths.
function createHarvester(artifactDir, envs) {
  if (typeof artifactDir !== 'string' || !path.isAbsolute(artifactDir)) throw new Error('Artifact directory must be absolute');
  fs.mkdirSync(artifactDir, { recursive: true });
  const sessionsOf = env => {
    const config = env.launch.claudeConfigDir;
    const projects = config ? path.join(config, 'projects') : null;
    if (!projects || !exists(projects)) return new Set();
    const found = new Set();
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const item = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(item);
        else if (entry.name.endsWith('.jsonl')) found.add(item);
      }
    };
    walk(projects);
    return found;
  };
  const seen = new Map(Object.entries(envs).map(([name, env]) => [name, sessionsOf(env)]));
  const index = [];
  return {
    record(arm, id, repeat, env) {
      const before = seen.get(arm) || new Set();
      const now = sessionsOf(env);
      seen.set(arm, now);
      const fresh = [...now].filter(file => !before.has(file));
      if (!fresh.length) return;
      const directory = path.join(artifactDir, `${id}--${arm}--${repeat}`);
      fs.mkdirSync(directory, { recursive: true });
      for (const file of fresh) fs.copyFileSync(file, path.join(directory, path.basename(file)));
      index.push({ id, arm, repeat, files: fresh.map(file => path.basename(file)) });
    },
    writeIndex() { fs.writeFileSync(path.join(artifactDir, 'artifact-index.json'), `${JSON.stringify(index, null, 1)}\n`); },
  };
}

function runEvaluation({ repoRoot = DEFAULT_REPO_ROOT, corpus = loadCorpus(), registration,
  repeats = 1, provider, family, allowRealProvider = false, executable, model, effort, authHome, environments,
  artifactDir = null, maxCalls = 300, deadlineMs = 3600000, callTimeoutMs = 300000 } = {}) {
  if (!provider && !allowRealProvider) throw new Error('Evaluation requires an injected provider or explicit opt-in');
  if (!bounded(maxCalls, 1, 2000) || !bounded(deadlineMs, 1, 8 * 3600000)
    || !bounded(callTimeoutMs, 1, 600000)) throw new Error('Invalid call or deadline bound');
  if (!provider && !registration) throw new Error('Real evaluation requires prior registration');
  const resolvedFamily = provider ? (family || 'codex') : resolveFamily(family, executable);
  if (resolvedFamily === 'claude' && effort !== undefined) throw new Error('Reasoning effort applies only to the Codex provider');
  const pin = preregister({ repoRoot, corpus, repeats, model, executable, effort });
  if (registration && !isDeepStrictEqual(registration, pin)) throw new Error('Registration pin mismatch');
  const injected = Boolean(provider);
  const liveProvider = provider || (resolvedFamily === 'claude'
    ? createClaudeProvider({ allowRealProvider, executable, model, persistSessions: Boolean(artifactDir) })
    : createCodexProvider({ allowRealProvider, executable, model, effort, authHome }));
  const state = { calls: 0, metrics: [], maxCalls, callTimeoutMs, family: resolvedFamily,
    deadline: Date.now() + deadlineMs, provider: liveProvider,
    assertCurrent() {
      if (digestObject(corpus) !== pin.corpusDigest || sourceSnapshot(repoRoot).sourceDigest !== pin.sourceDigest) fail('source-drift');
    } };
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ai-eval-')));
  const selection = [];
  const outcomes = [];
  let installs = null;
  let harvester = null;
  try {
    const installRoot = path.join(temp, 'installs');
    fs.mkdirSync(installRoot, { mode: 0o700 });
    const envs = environments || (injected ? syntheticEnvironments(installRoot)
      : resolvedFamily === 'claude'
        ? prepareClaudeEnvironments({ repoRoot, executable, root: installRoot,
          legacySource: exportLegacySource({ repoRoot, destination: path.join(installRoot, 'legacy-source') }) })
        : prepareEnvironments({ repoRoot, executable, root: installRoot }));
    installs = Object.fromEntries(Object.entries(envs).map(([name, env]) => [name,
      { profileId: env.profileId, skills: env.skills, ...(env.sourceSha ? { sourceSha: env.sourceSha } : {}) }]));
    harvester = artifactDir && resolvedFamily === 'claude' && !injected ? createHarvester(artifactDir, envs) : null;
    const harvest = harvester ? (arm, id, repeat, env) => harvester.record(arm, id, repeat, env) : null;
    for (const item of corpus.selection) {
      const cwd = path.join(temp, `${item.id}--selection`);
      fs.mkdirSync(cwd);
      const start = state.metrics.length;
      selection.push({ ...selectionProbe(item, repoRoot, executeAdapter(state, cwd, envs.lean), envs.lean, resolvedFamily),
        ...metricsSince(state.metrics, start) });
    }
    for (const scheduled of pin.order) {
      const item = corpus.tasks.find(c => c.id === scheduled.id);
      for (const arm of scheduled.arms) {
        const cwd = path.join(temp, `${item.id}--${arm}--${scheduled.repeat}`);
        const environment = envs[['full', 'baseline', 'ecc-legacy'].includes(arm) ? arm : 'lean'];
        fs.mkdirSync(cwd);
        writeWorkspace(cwd, item.files);
        const start = state.metrics.length;
        outcomes.push({ ...outcomeTrial(item, arm, scheduled.repeat, repoRoot,
          executeAdapter(state, cwd, environment), cwd, environment, resolvedFamily, harvest), ...metricsSince(state.metrics, start) });
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    }
    if (harvester) harvester.writeIndex();
  } finally { if (harvester) harvester.writeIndex(); fs.rmSync(temp, { recursive: true, force: true }); }
  const summary = summarize(outcomes);
  const insufficient = summary.distinctTasks < pin.minimumDistinctTasks || selection.length < pin.minimumDistinctTasks;
  const selectionSuccesses = selection.filter(row => row.passed).length;
  return { schemaVersion: 'ecc.context-eval.v2', registration: pin,
    evidence: injected ? 'injected-provider' : resolvedFamily === 'claude' ? 'claude-json' : 'codex-jsonl', installs,
    authentication: injected ? 'injected' : liveProvider.authentication, credentialsRetained: false,
    calls: state.calls, bounds: { maxCalls, deadlineMs, callTimeoutMs }, selection, outcomes, summary,
    selectionSummary: { n: selection.length, successes: selectionSuccesses,
      categories: [...new Set(selection.map(row => row.category))].map(category => ({ category,
        n: selection.filter(row => row.category === category).length,
        successes: selection.filter(row => row.category === category && row.passed).length })),
      interval: wilson(selectionSuccesses, selection.length), method: 'wilson-95-descriptive-purposive-sample' },
    gate: { status: insufficient ? 'insufficient-sample' : injected ? 'synthetic-only' : 'review-required',
      nonInferioritySupported: !insufficient && !injected && summary.pairs.every(p => p.interval[0] >= -pin.nonInferiorityMargin),
      releaseApproved: false }, nativeInvocation: 'unobserved',
    measurementScope: 'native-install-hidden-graded-coding-tasks',
    artifactRetention: harvester ? 'session-jsonl-per-task-trial' : 'none', ...metricsSince(state.metrics, 0) };
}

module.exports = { loadCorpus, preregister, runEvaluation, parseCodexJsonl, parseClaudeJson, summarize, wilson,
  runCheck, runScoredCheck, createAuthLease, createCodexProvider, createClaudeProvider, prepareEnvironments,
  prepareClaudeEnvironments, exportLegacySource, providerFamily, resolveFamily, readClaudeKeychainToken };
