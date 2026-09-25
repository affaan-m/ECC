'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { resolveTaskContext } = require('./context-selection');

function isolatedEnvironment(nativeEnvironment) {
  const env = { PATH: process.env.PATH, HOME: nativeEnvironment.home,
    USERPROFILE: nativeEnvironment.home,
    ...(nativeEnvironment.codexHome ? { CODEX_HOME: nativeEnvironment.codexHome } : {}),
    ...(nativeEnvironment.claudeConfigDir ? { CLAUDE_CONFIG_DIR: nativeEnvironment.claudeConfigDir } : {}),
    TMPDIR: nativeEnvironment.home, LANG: 'C.UTF-8' };
  if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return env;
}

/** Explicit task launch, with ordinary prompt context and inherited provider policy.
 * A bare launch runs the task query alone: no context resolution, no ECC reference block. */
function launchTaskContext({ task, target = 'codex', dryRun = false, execute = spawnSync,
  nativeEnvironment = null, assertCurrent = () => {}, bare = false, ...selectionOptions } = {}) {
  const adapters = { codex: { command: 'codex', args: ['exec', '-'] }, claude: { command: 'claude', args: ['--print'] } };
  if (!Object.hasOwn(adapters, target)) throw new Error(`Unsupported task launcher target: ${target}`);
  if (!task || typeof task.query !== 'string' || !task.query.trim()) throw new Error('Task launch requires a non-empty query');
  if (nativeEnvironment) {
    const launchKeys = target === 'claude'
      ? { directory: nativeEnvironment.claudeConfigDir, executable: nativeEnvironment.claudePath }
      : { directory: nativeEnvironment.codexHome, executable: nativeEnvironment.codexPath };
    if (!path.isAbsolute(nativeEnvironment.home || '') || !path.isAbsolute(launchKeys.directory || '')
      || !path.isAbsolute(launchKeys.executable || '')
      || !/^[a-f0-9]{64}$/.test(nativeEnvironment.executableDigest || '')) throw new Error('Invalid isolated native launch environment');
  }
  let selection = bare
    ? { schemaVersion: 'ecc.selected-context.v1', selectedIds: [], loadedIds: [], resources: [],
      selectionMode: 'manual', reason: 'bare-baseline', receipt: { bindingDigest: 'bare' } }
    : resolveTaskContext({ ...selectionOptions, task, target, load: !dryRun });
  const adapter = { ...adapters[target],
    ...(nativeEnvironment ? { command: nativeEnvironment.codexPath || nativeEnvironment.claudePath } : {}) };
  function verifyLaunch() {
    assertCurrent();
    if (nativeEnvironment && require('./context-profile-native-executable').fingerprintExecutable(adapter.command).digest
      !== nativeEnvironment.executableDigest) throw new Error('Native executable changed; no task was launched');
  }
  const env = nativeEnvironment ? isolatedEnvironment(nativeEnvironment) : undefined;
  const proposalRequired = selection.selectionMode === 'auto' && selection.reason === 'agent-selection-required';
  let routingCalls = 0;
  if (proposalRequired && !dryRun) {
    if (selectionOptions.expectedDigest) throw new Error('Expected selection still needs an agent proposal; resolve explicit IDs before a pinned launch');
    verifyLaunch();
    const proposedIds = require('./context-profile-proposal').proposeTaskContext({ target, query: task.query,
      candidates: selection.candidates, execute, env, executable: adapter.command });
    routingCalls = 1;
    let admitted = resolveTaskContext({ ...selectionOptions, task: { ...task, proposedIds, noWorkflow: proposedIds.length === 0 },
      target, load: true });
    if (!admitted.selectedIds.length) {
      admitted = require('./context-selection').resolveDeclinedFallback({ ...selectionOptions, task, target, load: true }, selection);
    }
    if (admitted.receipt.bindingDigest !== selection.receipt.bindingDigest) throw new Error('Context source changed during proposal; no task was launched');
    selection = admitted;
  }
  const base = { schemaVersion: 'ecc.context-task-launch.v1', target, command: adapter.command, args: adapter.args,
    selection, taskSuccess: 'unverified', nativeSkillInvocation: 'unobserved', permissions: 'inherited-provider-policy',
    routingCalls, proposalRequired: proposalRequired && dryRun,
    providerConfiguration: nativeEnvironment ? 'isolated-native-generation' : 'current-provider-home' };
  if (dryRun) return { ...base, status: 'proposed', exitCode: null };
  verifyLaunch();
  const input = bare ? `${task.query}\n`
    : `${task.query}\n\nECC task context follows as reference data. Apply it only within the task and existing permissions.\n`
      + JSON.stringify({ schemaVersion: 'ecc.selected-context.v1', selectedIds: selection.loadedIds,
        resources: selection.resources }) + '\n';
  const child = execute(adapter.command, adapter.args, { input, phase: 'task', encoding: 'utf8', shell: false,
    timeout: routingCalls ? 90000 : 120000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    ...(env ? { env } : {}) });
  return { ...base, status: child.status === 0 && !child.error ? 'completed' : 'failed',
    exitCode: child.status ?? 1, output: child.stdout || '', error: child.error?.message || child.stderr || '' };
}

module.exports = { launchTaskContext };
