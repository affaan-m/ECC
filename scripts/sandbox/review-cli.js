'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { buildLaunchPlan } = require('../../skills/terminal-opener/scripts/open-terminal');
const {
  buildProposalId,
  consentProposal,
  normalizeTerminal,
  requireMatchingProposal,
  validateConsent,
  validateProposalId,
  validatePurpose,
} = require('./consent');
const {
  createInteractiveLaunch,
  parseLaunchArgs,
} = require('./interactive-launch');
const {
  filteredSupervisorEnvironment,
  launchExploration,
  launchTerminal,
} = require('./visible-terminal');
const {
  appendEvent,
  createControl,
  createRun,
  defaultStateRoot,
  evaluateRun,
  readControlResponse,
  readEventsSince,
  readRun,
  readResources,
  transitionState,
  updateState,
  validateStateRoot,
  writeJsonAtomic,
} = require('./session-store');
const { superviseRun } = require('./supervisor');
const { exportMp4, writeCast } = require('./recording');
const { gcRuns, guardSession } = require('./guardian');
const { runExploration } = require('./exploration');
const { startLaunchWatchdog, watchLaunch } = require('./launch-watchdog');

const PUBLIC_COMMANDS = new Set([
  'review', 'runs', 'status', 'listen', 'inspect', 'continue', 'wait',
  'evaluate', 'attach', 'stop', 'gc', 'video', 'explore', 'launch',
]);
const INTERNAL_COMMANDS = new Set(['_supervise', '_ui', '_guard', '_explore', '_watch-launch']);
const TERMINAL_STATES = new Set(['completed', 'error', 'lease-expired', 'recovered']);
const POLL_MS = 100;

function handles(command) {
  return PUBLIC_COMMANDS.has(command) || INTERNAL_COMMANDS.has(command);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function valueAfter(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`);
  return value;
}

function parseReviewArgs(args) {
  const options = {
    manifestPath: null,
    dryRun: false,
    localOnly: false,
    capabilitiesPath: null,
    mockPath: null,
    shard: null,
    expectBackend: null,
    record: false,
    pauseReview: true,
    terminal: normalizeTerminal(process.env.ECC_TERMINAL || 'wezterm'),
    purpose: null,
    consent: null,
    proposalId: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--local-only') options.localOnly = true;
    else if (arg === '--record') options.record = true;
    else if (arg === '--no-pause') options.pauseReview = false;
    else if (['--capabilities', '--mock', '--expect-backend', '--terminal', '--purpose', '--consent', '--proposal'].includes(arg)) {
      const value = valueAfter(args, index, arg);
      if (arg === '--capabilities') options.capabilitiesPath = value;
      if (arg === '--mock') options.mockPath = value;
      if (arg === '--expect-backend') options.expectBackend = value;
      if (arg === '--terminal') options.terminal = normalizeTerminal(value);
      if (arg === '--purpose') options.purpose = validatePurpose(value);
      if (arg === '--consent') options.consent = validateConsent(value);
      if (arg === '--proposal') options.proposalId = validateProposalId(value);
      index += 1;
    } else if (arg.startsWith('-')) throw new Error(`Unknown review argument: ${arg}`);
    else if (!options.manifestPath) options.manifestPath = arg;
    else throw new Error(`Unexpected review argument: ${arg}`);
  }
  if (!options.manifestPath) throw new Error('review requires a sandbox manifest path');
  if (options.expectBackend && !['srt', 'podman', 'lume'].includes(options.expectBackend)) {
    throw new Error('--expect-backend must be srt, podman, or lume');
  }
  return options;
}

function parseRunReference(args, command) {
  if (!args[0]) throw new Error(`${command} requires a run ID`);
  let root = defaultStateRoot();
  let format = null;
  let terminal = null;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === '--state-root') {
      root = path.resolve(valueAfter(args, index, '--state-root'));
      index += 1;
    } else if (args[index] === '--terminal') {
      if (!['attach', 'explore'].includes(command)) {
        throw new Error(`--terminal is supported only for attach and explore`);
      }
      terminal = normalizeTerminal(valueAfter(args, index, '--terminal'));
      index += 1;
    } else if (args[index] === '--format') {
      format = valueAfter(args, index, '--format');
      const allowed = command === 'listen' ? ['jsonl'] : (command === 'video' ? ['mp4'] : []);
      if (!allowed.includes(format)) throw new Error(`Unsupported ${command} format: ${format}`);
      index += 1;
    } else if (!((command === 'listen' && args[index] === '--follow') || args[index] === '--json')) {
      throw new Error(`Unknown ${command} argument: ${args[index]}`);
    }
  }
  return { runId: args[0], root, format, terminal };
}

function selectedVisibleRoute(resolved, expectedBackend) {
  if (resolved.decision.result !== 'routable') {
    const failed = resolved.decision.routes.find(route => route.result === 'error');
    throw new Error(`${failed?.reason || 'sandbox route is unavailable'}. ${failed?.fix || ''}`.trim());
  }
  if (resolved.decision.routes.length !== 1 || resolved.decision.routes[0].backend === 'ci') {
    throw new Error('visible review requires exactly one local Tier 0, Tier 1, or Tier 2 route');
  }
  const route = resolved.decision.routes[0];
  if (!['srt', 'podman', 'lume'].includes(route.backend)) {
    throw new Error(`visible review does not support backend ${route.backend}`);
  }
  if (expectedBackend && expectedBackend !== route.backend) {
    throw new Error(`expected ${expectedBackend}, but deterministic routing selected ${route.backend}`);
  }
  return route;
}

function sameRoute(left, right) {
  return ['backend', 'tier', 'os', 'arch'].every(field => left[field] === right[field]);
}

function visibleTerminalPlan(options, context, root) {
  return buildLaunchPlan({
    terminal: options.terminal, cwd: process.cwd(), executable: process.execPath,
    argv: [context.cliPath, '_ui', 'RUN_ID', '--state-root', root],
    dryRun: true, mode: 'normal',
    environment: {
      mode: 'filtered',
      allowlist: ['PATH', 'TERM', 'LANG', 'LC_ALL', 'LC_CTYPE', 'COLORTERM'],
    },
  });
}

function createExploration(sourceRunId, root, context, dependencies = {}) {
  const source = readRun(sourceRunId, root);
  if (source.state.status !== 'completed' || source.session.exploration) {
    throw new Error('exploration requires a completed verification run');
  }
  if (readResources(sourceRunId, root).length > 0) {
    throw new Error('exploration requires a verification run with no owned resources remaining');
  }
  if (
    source.session.route.backend === 'podman'
    && source.session.route.tier === 1
    && (
      source.session.consent?.decision !== 'y'
      || typeof source.session.purpose !== 'string'
    )
  ) {
    throw new Error(
      'Tier 1 exploration requires a consented review run; use ecc-sandbox launch for a new manual session'
    );
  }
  const manifest = fs.readFileSync(source.session.manifest_path);
  const capabilities = source.session.capabilities_path
    ? fs.readFileSync(source.session.capabilities_path)
    : Buffer.from('{}\n');
  if (crypto.createHash('sha256').update(manifest).digest('hex') !== source.session.manifest_digest) {
    throw new Error('Approved sandbox manifest snapshot digest changed');
  }
  if (
    source.session.capabilities_digest
    && crypto.createHash('sha256').update(capabilities).digest('hex') !== source.session.capabilities_digest
  ) throw new Error('Approved sandbox capability snapshot digest changed');
  const created = createRun({
    root,
    manifestPath: source.session.manifest_path,
    originalManifestPath: source.session.original_manifest_path,
    manifestDigest: crypto.createHash('sha256').update(manifest).digest('hex'),
    workspacePath: source.session.workspace_path,
    route: source.session.route,
    record: false,
    pauseReview: false,
    localOnly: source.session.local_only,
    capabilitiesPath: source.session.capabilities_path,
    capabilitiesDigest: crypto.createHash('sha256').update(capabilities).digest('hex'),
    sourceRunId,
    exploration: true,
    requestedReport: source.session.requested_report,
    terminal: context.terminal || source.session.terminal || 'wezterm',
    purpose: source.session.purpose,
    consent: source.session.consent,
  });
  const manifestPath = path.join(created.run_directory, 'manifest.yaml');
  const capabilitiesPath = path.join(created.run_directory, 'capabilities.json');
  fs.writeFileSync(manifestPath, manifest, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(capabilitiesPath, capabilities, { mode: 0o600, flag: 'wx' });
  const sessionPath = path.join(created.run_directory, 'session.json');
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  session.manifest_path = manifestPath;
  session.capabilities_path = capabilitiesPath;
  writeJsonAtomic(sessionPath, session);
  updateState(created.run_id, root, { status: 'launching' });
  let terminal;
  try {
    terminal = launchExploration(created.run_id, root, context, dependencies);
    const watchdog = startLaunchWatchdog(created.run_id, root, context, dependencies);
    updateState(created.run_id, root, { launch_watchdog_pid: watchdog.pid || null });
  } catch (error) {
    updateState(created.run_id, root, { status: 'error', error: error.message });
    throw new Error(`Unable to open the visible ${created.session.terminal} exploration: ${error.message}`);
  }
  return {
    result: 'launching',
    state: 'launching',
    run_id: created.run_id,
    source_run_id: sourceRunId,
    backend: session.route.backend,
    tier: session.route.tier,
    evidence: false,
    listener: `ecc-sandbox listen ${created.run_id} --follow --format jsonl`,
    warning: 'exploration is an isolated replica and cannot modify verification evidence',
    terminal: terminal.plan.terminal,
    strategy: terminal.result.strategy,
  };
}

function exploreFromSession(runId, root, context, dependencies = {}) {
  const current = readRun(runId, root);
  if (!current.session.exploration) {
    throw new Error('internal exploration requires an exploration session');
  }
  const checkedIn = transitionState(runId, root, 'launching', {
    status: 'exploring', supervisor_pid: process.pid, launch_watchdog_pid: null,
  });
  if (!checkedIn.updated) {
    throw new Error(`exploration is no longer awaiting terminal check-in (${checkedIn.state.status})`);
  }
  appendEvent(runId, root, { type: 'exploration.started', phase: 'exploration' });
  const spawnImpl = dependencies.spawn || spawn;
  const guardian = spawnImpl(process.execPath, [
    context.cliPath, '_guard', runId, '--state-root', root,
  ], {
    cwd: current.session.workspace_path, detached: true, shell: false, stdio: 'ignore',
    env: filteredSupervisorEnvironment(),
  });
  guardian.once?.('error', () => {});
  guardian.unref?.();
  updateState(runId, root, { guardian_pid: guardian.pid || null });
  try {
    const outcome = runExploration(runId, root);
    const resources = readResources(runId, root);
    const clean = resources.length === 0;
    appendEvent(runId, root, {
      type: 'exploration.completed', phase: 'exploration',
      exit: outcome.exitCode, cleanup_pass: clean,
    });
    updateState(runId, root, {
      status: clean ? 'completed' : 'error',
      result: outcome.exitCode === 0 && clean ? 'pass' : 'error',
      exit_code: outcome.exitCode,
      error: clean ? null : 'exploration cleanup left owned resources for the guardian',
    });
    return outcome.exitCode;
  } catch (error) {
    appendEvent(runId, root, { type: 'exploration.failed', phase: 'exploration', text: error.message });
    updateState(runId, root, { status: 'error', error: error.message, exit_code: 2 });
    throw error;
  }
}

function createReview(options, context, dependencies = {}) {
  const root = validateStateRoot(dependencies.root || defaultStateRoot());
  const originalManifestPath = path.resolve(options.manifestPath);
  let preflightConsent = null;
  let preflightManifestDigest = null;
  let preflightRoute = null;
  if (!options.dryRun) {
    const preflight = context.resolveRun({
      ...options,
      manifestPath: originalManifestPath,
      mockPath: options.mockPath,
    });
    const route = selectedVisibleRoute(preflight, options.expectBackend);
    if (route.backend === 'podman' && route.tier === 1) {
      if (!options.purpose) {
        throw new Error('Tier 1 review requires --purpose before consent can be requested');
      }
      preflightManifestDigest = crypto.createHash('sha256')
        .update(fs.readFileSync(originalManifestPath))
        .digest('hex');
      const proposalId = buildProposalId({
        flow: 'review',
        manifestDigest: preflightManifestDigest,
        capabilities: preflight.capabilities,
        route,
        purpose: options.purpose,
        terminal: options.terminal,
      });
      requireMatchingProposal(options.proposalId, proposalId, options.consent);
      const proposal = consentProposal(
        preflight.manifest, options.purpose, options.consent, proposalId
      );
      if (!proposal.consent) {
        return {
          ...proposal,
          route,
          terminal: visibleTerminalPlan(options, context, root),
        };
      }
      preflightConsent = proposal;
      preflightRoute = route;
    }
  }
  let snapshotDirectory = null;
  let snapshotManifestPath = null;
  let snapshotMockPath = null;
  if (!options.dryRun) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    snapshotDirectory = path.join(root, `.creating-${crypto.randomBytes(12).toString('hex')}`);
    fs.mkdirSync(snapshotDirectory, { recursive: false, mode: 0o700 });
    snapshotManifestPath = path.join(snapshotDirectory, 'manifest.yaml');
    fs.copyFileSync(originalManifestPath, snapshotManifestPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(snapshotManifestPath, 0o600);
    if (options.mockPath) {
      snapshotMockPath = path.join(snapshotDirectory, 'mock.json');
      fs.copyFileSync(path.resolve(options.mockPath), snapshotMockPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(snapshotMockPath, 0o600);
    }
  }
  const discardSnapshot = () => {
    if (snapshotDirectory && fs.existsSync(snapshotDirectory)) {
      fs.rmSync(snapshotDirectory, { recursive: true, force: true });
    }
  };
  let resolved;
  try {
    resolved = context.resolveRun({
      ...options,
      manifestPath: snapshotManifestPath || originalManifestPath,
      mockPath: snapshotMockPath || options.mockPath,
    });
  } catch (error) {
    discardSnapshot();
    throw error;
  }
  let route;
  try {
    route = selectedVisibleRoute(resolved, options.expectBackend);
  } catch (error) {
    discardSnapshot();
    throw error;
  }
  if (preflightRoute && !sameRoute(preflightRoute, route)) {
    discardSnapshot();
    throw new Error('sandbox route changed after consent and before visible review');
  }
  const terminalPlan = visibleTerminalPlan(options, context, root);
  let consent = null;
  if (route.backend === 'podman' && route.tier === 1) {
    if (!options.purpose && !options.dryRun) {
      discardSnapshot();
      throw new Error('Tier 1 review requires --purpose before consent can be requested');
    }
    if (preflightConsent) {
      const snapshotDigest = crypto.createHash('sha256')
        .update(fs.readFileSync(snapshotManifestPath))
        .digest('hex');
      if (snapshotDigest !== preflightManifestDigest) {
        discardSnapshot();
        throw new Error('sandbox manifest changed after consent and before visible review');
      }
      const sealedProposalId = buildProposalId({
        flow: 'review',
        manifestDigest: snapshotDigest,
        capabilities: resolved.capabilities,
        route,
        purpose: options.purpose,
        terminal: options.terminal,
      });
      requireMatchingProposal(
        preflightConsent.consent.proposal_id, sealedProposalId, 'y'
      );
      const sealed = consentProposal(
        resolved.manifest,
        options.purpose,
        options.consent,
        preflightConsent.consent.proposal_id
      );
      if (sealed.consent.prompt !== preflightConsent.consent.prompt) {
        discardSnapshot();
        throw new Error('sandbox environment changed after consent and before visible review');
      }
      consent = preflightConsent;
    } else if (options.purpose) {
      const proposal = consentProposal(resolved.manifest, options.purpose, options.consent);
      if (!proposal.consent) {
        discardSnapshot();
        return { ...proposal, route, terminal: terminalPlan };
      }
      consent = proposal;
    }
  }
  if (options.dryRun) {
    return {
      result: 'routable',
      route,
      terminal: terminalPlan,
      creates_run: false,
      ...(consent ? { consent_prompt: consent.consent.prompt, purpose: consent.purpose } : {}),
    };
  }
  const manifestText = fs.readFileSync(snapshotManifestPath);
  const manifestDigest = crypto.createHash('sha256').update(manifestText).digest('hex');
  const manifestSnapshot = snapshotManifestPath;
  const capabilitiesSnapshot = path.join(snapshotDirectory, 'capabilities.json');
  const capabilitiesText = `${JSON.stringify(resolved.capabilities || {}, null, 2)}\n`;
  const capabilitiesDigest = crypto.createHash('sha256').update(capabilitiesText).digest('hex');
  fs.writeFileSync(capabilitiesSnapshot, capabilitiesText, { mode: 0o600, flag: 'wx' });
  const created = createRun({
    root,
    manifestPath: manifestSnapshot,
    originalManifestPath,
    manifestDigest,
    workspacePath: process.cwd(),
    route,
    record: options.record,
    pauseReview: options.pauseReview,
    localOnly: options.localOnly,
    capabilitiesPath: capabilitiesSnapshot,
    capabilitiesDigest,
    mockPath: snapshotMockPath,
    mockDigest: snapshotMockPath
      ? crypto.createHash('sha256').update(fs.readFileSync(snapshotMockPath)).digest('hex')
      : null,
    requestedReport: resolved.manifest?.report || null,
    terminal: terminalPlan.terminal,
    purpose: consent?.purpose || null,
    consent: consent?.consent || null,
  });
  fs.renameSync(manifestSnapshot, path.join(created.run_directory, 'manifest.yaml'));
  fs.renameSync(capabilitiesSnapshot, path.join(created.run_directory, 'capabilities.json'));
  if (snapshotMockPath) fs.renameSync(snapshotMockPath, path.join(created.run_directory, 'mock.json'));
  fs.rmdirSync(snapshotDirectory);
  const finalManifestPath = path.join(created.run_directory, 'manifest.yaml');
  const snapshotCapabilitiesPath = path.join(created.run_directory, 'capabilities.json');
  const sessionPath = path.join(created.run_directory, 'session.json');
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  session.manifest_path = finalManifestPath;
  session.capabilities_path = snapshotCapabilitiesPath;
  if (snapshotMockPath) session.mock_path = path.join(created.run_directory, 'mock.json');
  writeJsonAtomic(sessionPath, session);
  if (consent) {
    appendEvent(created.run_id, root, {
      type: 'consent.granted',
      phase: 'consent',
      purpose: consent.purpose,
      prompt: consent.consent.prompt,
      proposal_id: consent.consent.proposal_id,
    });
  }
  const spawnImpl = dependencies.spawn || spawn;
  const supervisor = spawnImpl(process.execPath, [
    context.cliPath, '_supervise', created.run_id, '--state-root', root,
  ], {
    cwd: process.cwd(), detached: true, shell: false, stdio: 'ignore',
    env: filteredSupervisorEnvironment(),
  });
  supervisor.once?.('error', () => {});
  supervisor.unref?.();
  updateState(created.run_id, root, { supervisor_pid: supervisor.pid || null });
  const guardian = spawnImpl(process.execPath, [
    context.cliPath, '_guard', created.run_id, '--state-root', root,
  ], {
    cwd: process.cwd(), detached: true, shell: false, stdio: 'ignore',
    env: filteredSupervisorEnvironment(),
  });
  guardian.once?.('error', () => {});
  guardian.unref?.();
  updateState(created.run_id, root, { guardian_pid: guardian.pid || null });
  let terminal;
  try {
    terminal = launchTerminal(created.run_id, root, context, dependencies);
  } catch (error) {
    createControl(created.run_id, root, 'stop');
    throw new Error(`Unable to open the visible ${options.terminal} review: ${error.message}`);
  }
  return {
    result: 'launching',
    state: 'awaiting-ui',
    run_id: created.run_id,
    run_directory: created.run_directory,
    backend: route.backend,
    tier: route.tier,
    listener: `ecc-sandbox listen ${created.run_id} --follow --format jsonl`,
    terminal: terminal.plan.terminal,
    terminal_strategy: terminal.result.strategy,
  };
}

function superviseFromSession(runId, root, context) {
  const current = readRun(runId, root);
  const snapshot = fs.readFileSync(current.session.manifest_path);
  const digest = crypto.createHash('sha256').update(snapshot).digest('hex');
  if (digest !== current.session.manifest_digest) throw new Error('Approved sandbox manifest snapshot digest changed');
  if (current.session.capabilities_path && current.session.capabilities_digest) {
    const capabilities = fs.readFileSync(current.session.capabilities_path);
    const capabilitiesDigest = crypto.createHash('sha256').update(capabilities).digest('hex');
    if (capabilitiesDigest !== current.session.capabilities_digest) {
      throw new Error('Approved sandbox capability snapshot digest changed');
    }
  }
  if (current.session.mock_path && current.session.mock_digest) {
    const mock = fs.readFileSync(current.session.mock_path);
    const mockDigest = crypto.createHash('sha256').update(mock).digest('hex');
    if (mockDigest !== current.session.mock_digest) {
      throw new Error('Approved sandbox mock snapshot digest changed');
    }
  }
  const options = {
    manifestPath: current.session.manifest_path,
    localOnly: current.session.local_only,
    capabilitiesPath: current.session.capabilities_path,
    mockPath: current.session.mock_path,
    dryRun: false,
    shard: null,
  };
  const rerouted = context.resolveRun(options);
  const approved = current.session.route;
  const selected = rerouted.decision.routes[0];
  if (
    rerouted.decision.result !== 'routable'
    || rerouted.decision.routes.length !== 1
    || selected.backend !== approved.backend
    || selected.tier !== approved.tier
    || selected.os !== approved.os
    || selected.arch !== approved.arch
  ) throw new Error('Approved sandbox route changed before execution');
  const outcome = superviseRun(runId, root, {
    execute: lifecycle => context.runExecution(options, {
      lifecycle,
      streamOutput: { runId, root },
      runId,
      ownerToken: current.session.owner_token,
      containerName: `ecc-sandbox-${runId}`,
      vmName: `ecc-sandbox-lume-${runId.slice(4)}`,
    }),
  });
  return outcome.exitCode;
}

function sendControl(runId, root, action, waitForResponse = false) {
  const control = createControl(runId, root, action);
  if (!waitForResponse) return { result: 'accepted', run_id: runId, control_id: control.control_id, action };
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const response = readControlResponse(runId, root, control.control_id);
    if (response) return response;
    sleep(POLL_MS);
  }
  throw new Error(`${action} control timed out after 30 seconds`);
}

function waitForTerminal(runId, root) {
  while (true) {
    const current = readRun(runId, root);
    if (TERMINAL_STATES.has(current.state.status)) return current;
    sleep(POLL_MS);
  }
}

function startUi(runId, root) {
  const initial = readRun(runId, root);
  if (!TERMINAL_STATES.has(initial.state.status) && initial.state.ui_connected !== true) {
    createControl(runId, root, 'ui-ready');
  }
  process.stdout.write(`ECC sandbox review ${runId}\n`);
  process.stdout.write(`Tier ${initial.session.route.tier} ${initial.session.route.backend}\n`);
  process.stdout.write('Enter continue | i inspect | x stop | q detach\n\n');
  let journalOffset = 0;
  let closed = false;
  let detachedSent = false;
  let timer = null;
  let inputHandler = null;
  const markDetached = () => {
    if (detachedSent) return;
    detachedSent = true;
    try {
      const state = readRun(runId, root).state;
      if (!TERMINAL_STATES.has(state.status)) createControl(runId, root, 'ui-detached');
    } catch {
      // The run may have been garbage-collected after completion.
    }
  };
  const onHangup = () => { markDetached(); process.exit(0); };
  const onTerminate = () => { markDetached(); process.exit(0); };
  const closeUi = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    if (inputHandler) process.stdin.removeListener('data', inputHandler);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.removeListener('exit', markDetached);
    process.removeListener('SIGHUP', onHangup);
    process.removeListener('SIGTERM', onTerminate);
  };
  process.once('exit', markDetached);
  process.once('SIGHUP', onHangup);
  process.once('SIGTERM', onTerminate);
  const render = () => {
    if (closed) return;
    const batch = readEventsSince(runId, root, journalOffset);
    journalOffset = batch.offset;
    for (const event of batch.events) {
      const fields = [];
      if (event.text) fields.push(event.text.trimEnd());
      for (const name of ['exit', 'pass', 'result', 'resource_kind', 'resource_name']) {
        if (event[name] !== undefined && event[name] !== null) fields.push(`${name}=${event[name]}`);
      }
      const output = fields.length > 0 ? ` ${fields.join(' ')}` : '';
      process.stdout.write(`[${event.seq}] ${event.type}${output}\n`);
    }
    const state = readRun(runId, root).state;
    if (TERMINAL_STATES.has(state.status)) {
      closeUi();
    }
  };
  timer = setInterval(render, 100);
  render();
  if (!closed && process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    inputHandler = data => {
      const key = data.toString('utf8');
      if (key === '\r' || key === '\n') sendControl(runId, root, 'continue');
      else if (key === 'i') {
        try {
          const response = sendControl(runId, root, 'inspect', true);
          process.stdout.write(`${JSON.stringify(response.inspection, null, 2)}\n`);
        } catch (error) {
          process.stdout.write(`Inspection error: ${error.message}\n`);
        }
      } else if (key === 'x') sendControl(runId, root, 'stop');
      else if (key === 'q' || key === '\u0003') {
        markDetached();
        closeUi();
      }
    };
    process.stdin.on('data', inputHandler);
  }
  return 0;
}

function listRuns(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(name => /^run_[a-f0-9]{32}$/.test(name)).flatMap(runId => {
    try {
      const current = readRun(runId, root);
      return [{ run_id: runId, ...current.state, route: current.session.route }];
    } catch {
      return [];
    }
  }).sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

function parseCollectionArgs(args, command) {
  let root = defaultStateRoot();
  let active = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--state-root') {
      root = path.resolve(valueAfter(args, index, '--state-root'));
      index += 1;
    } else if (command === 'runs' && args[index] === '--active') active = true;
    else throw new Error(`Unknown ${command} argument: ${args[index]}`);
  }
  return { root, active };
}

function streamEvents(runId, root, follow) {
  let journalOffset = 0;
  while (true) {
    const batch = readEventsSince(runId, root, journalOffset);
    journalOffset = batch.offset;
    for (const event of batch.events) process.stdout.write(`${JSON.stringify(event)}\n`);
    const state = readRun(runId, root).state;
    if (!follow || TERMINAL_STATES.has(state.status)) return 0;
    sleep(POLL_MS);
  }
}

function runCommand(command, args, context) {
  if (command === 'launch') {
    context.writeJson(createInteractiveLaunch(parseLaunchArgs(args), context));
    return 0;
  }
  if (command === 'review') {
    context.writeJson(createReview(parseReviewArgs(args), context));
    return 0;
  }
  if (command === 'runs') {
    const options = parseCollectionArgs(args, 'runs');
    const runs = listRuns(options.root).filter(run => !options.active || !TERMINAL_STATES.has(run.status));
    context.writeJson({ runs });
    return 0;
  }
  if (command === 'gc') {
    const options = parseCollectionArgs(args, 'gc');
    context.writeJson(gcRuns(options.root));
    return 0;
  }
  const reference = parseRunReference(args, command);
  if (command === '_supervise') return superviseFromSession(reference.runId, reference.root, context);
  if (command === '_ui') return startUi(reference.runId, reference.root);
  if (command === '_explore') return exploreFromSession(reference.runId, reference.root, context);
  if (command === '_watch-launch') {
    const outcome = watchLaunch(reference.runId, reference.root);
    return outcome.result === 'launch-timeout' ? 2 : 0;
  }
  if (command === '_guard') {
    guardSession(reference.runId, reference.root);
    return 0;
  }
  if (command === 'status') {
    context.writeJson(readRun(reference.runId, reference.root).state);
    return 0;
  }
  if (command === 'listen') return streamEvents(reference.runId, reference.root, args.includes('--follow'));
  if (command === 'inspect') {
    context.writeJson(sendControl(reference.runId, reference.root, 'inspect', true));
    return 0;
  }
  if (command === 'continue' || command === 'stop') {
    context.writeJson(sendControl(reference.runId, reference.root, command));
    return 0;
  }
  if (command === 'wait') {
    const current = waitForTerminal(reference.runId, reference.root);
    const reportPath = path.join(current.run_directory, 'report.json');
    if (!fs.existsSync(reportPath) && current.session.exploration) {
      context.writeJson({
        run_id: reference.runId,
        source_run_id: current.session.source_run_id,
        status: current.state.status,
        result: current.state.result,
        exit_code: current.state.exit_code,
        evidence: false,
      });
      return current.state.exit_code || 0;
    }
    if (!fs.existsSync(reportPath)) throw new Error(current.state.error || 'run ended without a report');
    context.writeJson(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
    return current.state.exit_code || 0;
  }
  if (command === 'evaluate') {
    context.writeJson(evaluateRun(reference.runId, reference.root));
    return 0;
  }
  if (command === 'attach') {
    const terminalContext = reference.terminal ? { ...context, terminal: reference.terminal } : context;
    const terminal = launchTerminal(reference.runId, reference.root, terminalContext);
    context.writeJson({
      result: 'attached',
      run_id: reference.runId,
      terminal: terminal.plan.terminal,
      strategy: terminal.result.strategy,
    });
    return 0;
  }
  if (command === 'explore') {
    const terminalContext = reference.terminal ? { ...context, terminal: reference.terminal } : context;
    context.writeJson(createExploration(reference.runId, reference.root, terminalContext));
    return 0;
  }
  if (command === 'video') {
    const current = readRun(reference.runId, reference.root);
    if (!TERMINAL_STATES.has(current.state.status)) {
      throw new Error('video export requires a terminal sandbox run');
    }
    const cast = writeCast(reference.runId, reference.root);
    const video = exportMp4(reference.runId, reference.root);
    context.writeJson({ result: 'recorded', run_id: reference.runId, cast, video });
    return 0;
  }
  throw new Error(`${command} is not implemented`);
}

module.exports = {
  createReview,
  createExploration,
  createInteractiveLaunch,
  exploreFromSession,
  filteredSupervisorEnvironment,
  handles,
  launchTerminal,
  launchExploration,
  listRuns,
  parseReviewArgs,
  parseLaunchArgs,
  runCommand,
  sendControl,
  startUi,
  streamEvents,
  superviseFromSession,
  waitForTerminal,
  watchLaunch,
};
