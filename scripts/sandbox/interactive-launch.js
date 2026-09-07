'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  appendEvent,
  createRun,
  defaultStateRoot,
  updateState,
  validateStateRoot,
  writeJsonAtomic,
} = require('./session-store');
const {
  buildProposalId,
  consentProposal,
  normalizeTerminal,
  requireMatchingProposal,
  validateConsent,
  validateProposalId,
  validatePurpose,
} = require('./consent');
const { launchExploration } = require('./visible-terminal');
const { startLaunchWatchdog } = require('./launch-watchdog');

function valueAfter(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`);
  return value;
}

function parseLaunchArgs(args) {
  const options = {
    manifestPath: null,
    localOnly: true,
    capabilitiesPath: null,
    purpose: null,
    consent: null,
    proposalId: null,
    terminal: normalizeTerminal(process.env.ECC_TERMINAL || 'wezterm'),
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--local-only') options.localOnly = true;
    else if (['--capabilities', '--purpose', '--consent', '--proposal', '--terminal'].includes(argument)) {
      const value = valueAfter(args, index, argument);
      if (argument === '--capabilities') options.capabilitiesPath = value;
      if (argument === '--purpose') options.purpose = validatePurpose(value);
      if (argument === '--consent') options.consent = validateConsent(value);
      if (argument === '--proposal') options.proposalId = validateProposalId(value);
      if (argument === '--terminal') options.terminal = normalizeTerminal(value);
      index += 1;
    } else if (argument.startsWith('-')) throw new Error(`Unknown launch argument: ${argument}`);
    else if (!options.manifestPath) options.manifestPath = argument;
    else throw new Error(`Unexpected launch argument: ${argument}`);
  }
  if (!options.manifestPath) throw new Error('launch requires a sandbox manifest path');
  if (!options.purpose) throw new Error('launch requires --purpose with the behavior being tested');
  return options;
}

function selectedRoute(resolved) {
  if (resolved.decision.result !== 'routable') {
    const failed = resolved.decision.routes.find(route => route.result === 'error');
    throw new Error(`${failed?.reason || 'sandbox route is unavailable'}. ${failed?.fix || ''}`.trim());
  }
  if (resolved.decision.routes.length !== 1) {
    throw new Error('interactive launch requires exactly one local Tier 1 Podman route');
  }
  const route = resolved.decision.routes[0];
  if (route.backend !== 'podman' || route.tier !== 1) {
    throw new Error('interactive launch supports only a local Tier 1 rootless Podman route');
  }
  return route;
}

function sameRoute(left, right) {
  return ['backend', 'tier', 'os', 'arch'].every(field => left[field] === right[field]);
}

function createSnapshot(root, originalManifestPath, resolved) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = path.join(root, `.creating-${crypto.randomBytes(12).toString('hex')}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  const manifestPath = path.join(staging, 'manifest.yaml');
  const capabilitiesPath = path.join(staging, 'capabilities.json');
  try {
    fs.copyFileSync(originalManifestPath, manifestPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(manifestPath, 0o600);
    fs.writeFileSync(
      capabilitiesPath,
      `${JSON.stringify(resolved.capabilities || {}, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' }
    );
    return { staging, manifestPath, capabilitiesPath };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function sealSnapshot(created, snapshot) {
  const finalManifestPath = path.join(created.run_directory, 'manifest.yaml');
  const finalCapabilitiesPath = path.join(created.run_directory, 'capabilities.json');
  fs.renameSync(snapshot.manifestPath, finalManifestPath);
  fs.renameSync(snapshot.capabilitiesPath, finalCapabilitiesPath);
  fs.rmdirSync(snapshot.staging);
  const sessionPath = path.join(created.run_directory, 'session.json');
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  writeJsonAtomic(sessionPath, {
    ...session,
    manifest_path: finalManifestPath,
    capabilities_path: finalCapabilitiesPath,
  });
}

function createInteractiveLaunch(options, context, dependencies = {}) {
  const root = validateStateRoot(dependencies.root || defaultStateRoot());
  const originalManifestPath = path.resolve(options.manifestPath);
  const resolved = context.resolveRun({
    manifestPath: originalManifestPath,
    localOnly: true,
    capabilitiesPath: options.capabilitiesPath,
    dryRun: true,
  });
  const route = selectedRoute(resolved);
  const originalManifest = fs.readFileSync(originalManifestPath);
  const originalManifestDigest = crypto.createHash('sha256').update(originalManifest).digest('hex');
  const proposalId = buildProposalId({
    flow: 'launch',
    manifestDigest: originalManifestDigest,
    capabilities: resolved.capabilities,
    route,
    purpose: options.purpose,
    terminal: options.terminal,
  });
  requireMatchingProposal(options.proposalId, proposalId, options.consent);
  const proposal = consentProposal(
    resolved.manifest, options.purpose, options.consent, proposalId
  );
  if (!proposal.consent) {
    return { ...proposal, backend: route.backend, tier: route.tier, terminal: options.terminal };
  }

  const snapshot = createSnapshot(root, originalManifestPath, resolved);
  let created;
  try {
    const sealedResolved = context.resolveRun({
      manifestPath: snapshot.manifestPath,
      localOnly: true,
      capabilitiesPath: snapshot.capabilitiesPath,
      dryRun: true,
    });
    const sealedRoute = selectedRoute(sealedResolved);
    if (!sameRoute(route, sealedRoute)) {
      throw new Error('sandbox route changed after consent and before interactive launch');
    }
    const sealedConsent = consentProposal(
      sealedResolved.manifest,
      proposal.purpose,
      proposal.consent.decision,
      proposal.consent.proposal_id
    );
    if (sealedConsent.consent.prompt !== proposal.consent.prompt) {
      throw new Error('sandbox environment changed after consent and before interactive launch');
    }
    const manifest = fs.readFileSync(snapshot.manifestPath);
    const manifestDigest = crypto.createHash('sha256').update(manifest).digest('hex');
    if (manifestDigest !== originalManifestDigest) {
      throw new Error('sandbox manifest changed after consent and before interactive launch');
    }
    const sealedProposalId = buildProposalId({
      flow: 'launch',
      manifestDigest,
      capabilities: sealedResolved.capabilities,
      route: sealedRoute,
      purpose: proposal.purpose,
      terminal: options.terminal,
    });
    requireMatchingProposal(proposal.consent.proposal_id, sealedProposalId, 'y');
    const capabilities = fs.readFileSync(snapshot.capabilitiesPath);
    created = createRun({
      root,
      manifestPath: snapshot.manifestPath,
      originalManifestPath,
      manifestDigest,
      workspacePath: process.cwd(),
      route: sealedRoute,
      record: false,
      pauseReview: false,
      localOnly: true,
      capabilitiesPath: snapshot.capabilitiesPath,
      capabilitiesDigest: crypto.createHash('sha256').update(capabilities).digest('hex'),
      exploration: true,
      requestedReport: sealedResolved.manifest?.report || null,
      terminal: options.terminal,
      purpose: proposal.purpose,
      consent: proposal.consent,
    });
    sealSnapshot(created, snapshot);
  } catch (error) {
    fs.rmSync(snapshot.staging, { recursive: true, force: true });
    if (created?.run_directory) {
      fs.rmSync(created.run_directory, { recursive: true, force: true });
    }
    throw error;
  }

  appendEvent(created.run_id, root, {
    type: 'consent.granted',
    phase: 'consent',
    purpose: proposal.purpose,
    prompt: proposal.consent.prompt,
    proposal_id: proposal.consent.proposal_id,
  });
  appendEvent(created.run_id, root, {
    type: 'exploration.created',
    phase: 'exploration',
    evidence: false,
  });
  updateState(created.run_id, root, { status: 'launching' });
  let terminal;
  try {
    terminal = launchExploration(created.run_id, root, {
      ...context,
      terminal: options.terminal,
    }, dependencies);
    const watchdog = startLaunchWatchdog(created.run_id, root, context, dependencies);
    updateState(created.run_id, root, { launch_watchdog_pid: watchdog.pid || null });
  } catch (error) {
    updateState(created.run_id, root, { status: 'error', error: error.message });
    throw new Error(`Unable to open the visible ${options.terminal} exploration: ${error.message}`);
  }
  return {
    result: 'launching',
    state: 'launching',
    run_id: created.run_id,
    backend: route.backend,
    tier: route.tier,
    evidence: false,
    listener: `ecc-sandbox listen ${created.run_id} --follow --format jsonl`,
    warning: 'interactive exploration is non-evidence and cannot produce a verification pass',
    terminal: terminal.plan.terminal,
    strategy: terminal.result.strategy,
  };
}

module.exports = {
  createInteractiveLaunch,
  parseLaunchArgs,
};
