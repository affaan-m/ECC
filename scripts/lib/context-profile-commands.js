'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createSourceReader } = require('./context-profile-support');

const NATIVE_COMMANDS = ['prepare-native', 'native-status', 'native-rollback', 'native-recover'];
const COMMANDS = ['start', 'resolve', 'run', 'set', 'mode', 'status', 'rollback', 'recover', ...NATIVE_COMMANDS];
const VALUE_FLAGS = ['--task-input', '--previous', '--expected-digest', '--state-root', '--expected-revision',
  '--target', '--selection', '--include', '--exclude', '--native-root'];

function parse(argv) {
  const args = argv.filter(arg => arg !== '--dry-run');
  const result = { command: args.shift(), include: [], exclude: [], json: false,
    dryRun: argv.includes('--dry-run') || process.env.ECC_DRY_RUN === '1', load: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') result.json = true;
    else if (arg === '--load' && result.command === 'resolve') result.load = true;
    else if (VALUE_FLAGS.includes(arg)) {
      const value = args[++index];
      if (!value || (value.startsWith('-') && !(arg === '--task-input' && value === '-'))) throw new Error(`Missing value for ${arg}`);
      if (seen.has(arg) && !['--include', '--exclude'].includes(arg)) throw new Error(`Duplicate argument: ${arg}`);
      seen.add(arg);
      if (arg === '--include') result.include.push(value);
      else if (arg === '--exclude') result.exclude.push(value);
      else result[arg.slice(2)] = value;
    } else if (!arg.startsWith('-') && !result.profileId && ['resolve', 'run', 'set', 'mode'].includes(result.command)) result.profileId = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const taskCommand = ['resolve', 'run'].includes(result.command);
  const allowed = result.command === 'start' ? ['--state-root', '--native-root'] : NATIVE_COMMANDS.includes(result.command)
    ? ['--state-root', '--native-root', '--expected-revision', '--expected-digest'] : taskCommand
    ? ['--task-input', '--previous', '--expected-digest', '--state-root', '--target', '--selection', '--include', '--exclude',
      ...(result.command === 'run' ? ['--native-root'] : [])]
    : result.command === 'set'
      ? ['--state-root', '--expected-revision', '--expected-digest', '--target', '--selection', '--include', '--exclude']
      : ['--state-root', ...(['rollback', 'mode'].includes(result.command) ? ['--expected-revision'] : [])];
  for (const flag of seen) if (!allowed.includes(flag)) throw new Error(`${flag} is unavailable for ${result.command}`);
  if (taskCommand && !result['task-input']) throw new Error(`${result.command} requires --task-input`);
  if (!taskCommand && !result['state-root']) throw new Error(`${result.command} requires --state-root`);
  if ((NATIVE_COMMANDS.includes(result.command) || result.command === 'start') && !result['native-root']) throw new Error(`${result.command} requires --native-root`);
  if (result['native-root'] && !result['state-root']) throw new Error('--native-root requires --state-root');
  if (result.command === 'mode' && !['auto', 'manual', 'suggest'].includes(result.profileId)) throw new Error('Choose mode auto, manual, or suggest');
  if (taskCommand && result['state-root']
    && (result.profileId || [...seen].some(flag => ['--target', '--selection', '--include', '--exclude'].includes(flag)))) {
    throw new Error('Stored profile resolution cannot override its profile, mode, target or exclusions');
  }
  if (result['expected-revision'] !== undefined && !/^(0|[1-9][0-9]*)$/.test(result['expected-revision'])) {
    throw new Error('Expected revision must be a nonnegative integer');
  }
  if (result.command === 'start' && result.json && !result.dryRun) {
    throw new Error('--json requires --dry-run for interactive start');
  }
  return result;
}

function readInput(file) {
  if (file === '-') {
    const bytes = Buffer.alloc(65537);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(0, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 65536) throw new Error('Task input exceeds the 65536-byte limit');
    const content = bytes.subarray(0, length);
    const text = content.toString('utf8');
    if (!Buffer.from(text).equals(content) || text.includes('\0')) throw new Error('Task input must be UTF-8 JSON without NUL');
    try { return JSON.parse(text); } catch { throw new Error('Task input must be valid JSON'); }
  }
  const absolute = path.resolve(file);
  const resource = createSourceReader(path.dirname(absolute)).read(path.basename(absolute));
  if (resource.bytes > 65536) throw new Error('Task input exceeds the 65536-byte limit');
  try { return JSON.parse(resource.content.toString('utf8')); }
  catch { throw new Error('Task input must be valid JSON'); }
}

function execute(options) {
  if (options.command === 'start') {
    if (!options.dryRun && (!process.stdin.isTTY || !process.stdout.isTTY)) {
      throw new Error('Interactive start requires a terminal; use --dry-run --json to inspect it');
    }
    return { interactive: require('./context-profile-interactive').startInteractiveProfile({
      stateRoot: options['state-root'], nativeRoot: options['native-root'], dryRun: options.dryRun }) };
  }
  if (NATIVE_COMMANDS.includes(options.command)) {
    const native = require('./context-profile-native');
    const input = { stateRoot: options['state-root'], nativeRoot: options['native-root'],
      ...(options['expected-revision'] === undefined ? {} : { expectedRevision: Number(options['expected-revision']) }),
      ...(options['expected-digest'] ? { expectedCarrierDigest: options['expected-digest'] } : {}) };
    const method = options.command === 'native-status' ? 'getNativeProfileStatus'
      : options.dryRun ? 'previewNativeProfile' : ({ 'prepare-native': 'prepareNativeProfile',
        'native-rollback': 'rollbackNativeProfile', 'native-recover': 'recoverNativeProfile' })[options.command];
    return { native: native[method](input) };
  }
  if (['resolve', 'run'].includes(options.command)) {
    const { resolveTaskContext } = require('./context-selection');
    const stored = options['state-root']
      ? require('./context-profile-store').getStoreStatus({ stateRoot: options['state-root'] }) : null;
    if (stored && (!stored.configured || stored.recoveryRequired)) throw new Error('Configure or recover the stored profile before resolving');
    if (stored) {
      const carrier = require('./context-carriers').planContextCarrier({ profileId: stored.profileId,
        target: stored.target, selectionMode: stored.selectionMode, include: stored.include, exclude: stored.exclude });
      if (carrier.carrierDigest !== stored.carrierDigest) throw new Error('Stored profile source is stale; preview and set the current generation before resolving');
    }
    const input = { task: readInput(options['task-input']),
      profileId: stored?.profileId || options.profileId || 'lean@1', target: stored?.target || options.target || 'codex',
      selectionMode: stored?.selectionMode || options.selection || 'auto', include: stored?.include || options.include,
      exclude: stored?.exclude || options.exclude,
      load: options.load && !options.dryRun,
      previous: options.previous ? readInput(options.previous) : null,
      expectedDigest: options['expected-digest'] || null };
    if (options.command === 'run') {
      const { load: _load, ...launchInput } = input;
      const native = options['native-root'] ? require('./context-profile-native').getNativeProfileStatus({
        stateRoot: options['state-root'], nativeRoot: options['native-root'] }) : null;
      if (native && !native.ready) throw new Error('Prepare or recover the native generation before launching');
      return { launch: require('./context-profile-launch').launchTaskContext({ ...launchInput, dryRun: options.dryRun,
        nativeEnvironment: native ? { home: native.home, codexHome: native.codexHome,
          codexPath: native.codexPath, executableDigest: native.executableDigest } : null,
        assertCurrent() {
          if (stored) {
            const current = require('./context-profile-store').getStoreStatus({ stateRoot: options['state-root'] });
            if (current.recoveryRequired || current.revision !== stored.revision || current.receiptDigest !== stored.receiptDigest) {
              throw new Error('Stored profile changed during proposal; no task was launched');
            }
          }
          if (native) {
            const current = require('./context-profile-native').getNativeProfileStatus({ stateRoot: options['state-root'], nativeRoot: options['native-root'] });
            if (!current.ready || current.revision !== native.revision) throw new Error('Native generation changed during proposal; no task was launched');
          }
        } }) };
    }
    return { selection: resolveTaskContext(input) };
  }
  const store = require('./context-profile-store');
  const common = { stateRoot: options['state-root'],
    ...(options['expected-revision'] === undefined ? {} : { expectedRevision: Number(options['expected-revision']) }) };
  if (options.command === 'status') return { store: store.getStoreStatus(common) };
  if (options.command === 'mode') {
    const current = store.getStoreStatus(common);
    if (!current.configured || current.recoveryRequired) throw new Error('Configure or recover the stored profile before changing mode');
    const input = { ...common, expectedRevision: common.expectedRevision ?? current.revision,
      profileId: current.profileId, target: current.target, include: current.include, exclude: current.exclude,
      selectionMode: options.profileId };
    return { store: options.dryRun ? store.previewStore(input) : store.applyStore(input) };
  }
  if (options.command === 'rollback' || options.command === 'recover') {
    if (options.dryRun) return { store: store.getStoreStatus(common), dryRun: true };
    return { store: options.command === 'rollback' ? store.rollbackStore(common) : store.recoverStore(common) };
  }
  const input = { ...common, profileId: options.profileId || 'lean@1', target: options.target || 'codex',
    selectionMode: options.selection || 'auto', include: options.include, exclude: options.exclude,
    ...(options['expected-digest'] ? { expectedCarrierDigest: options['expected-digest'] } : {}) };
  return { store: options.dryRun ? store.previewStore(input) : store.applyStore(input) };
}

function run(argv) {
  const options = parse(argv);
  const value = execute(options);
  return { schemaVersion: 'ecc.profile-operation.v1', status: (value.launch?.status === 'failed' || value.interactive?.status === 'failed') ? 'error' : 'success',
    summary: options.command === 'start' ? 'Opt-in interactive Codex uses the verified isolated generation and inherited terminal. Context selection remains advisory.'
      : options.command === 'run' ? 'Task launch uses selected context and the provider configuration. Inspect the launch result.'
      : options.command === 'resolve' ? 'Task context resolved within the selected profile.'
      : 'Managed profile generation inspected. Native activation is a separate provider boundary.',
    activation: value.selection?.activation || 'unobserved', next_actions: [], artifacts: [], ...value };
}

module.exports = { COMMANDS, run };
