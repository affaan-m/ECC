'use strict';

const crypto = require('crypto');

const executionFabric = Object.freeze({
  artifacts: require('./fabric/artifact-store'),
  contracts: require('./fabric/contracts'),
  credentials: require('./fabric/credential-broker'),
  environment: require('./fabric/environment-receipt'),
  evaluation: require('./fabric/evaluator'),
  events: require('./fabric/event-store'),
  patches: require('./fabric/patch-artifact'),
  promotion: require('./fabric/promoter'),
  routing: require('./fabric/route-policy'),
  scheduler: require('./fabric/scheduler'),
  snapshots: require('./fabric/snapshot-store'),
  trajectory: require('./fabric/trajectory'),
  visual: require('./fabric/visual-evidence'),
  workspace: require('./fabric/workspace'),
});

const WORKSPACE_MODES = new Set(['in-place', 'isolated-copy', 'worktree']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function routeJobId(route, index) {
  const raw = `job_${index + 1}_${route.backend}_${route.os}_${route.arch}`;
  return raw.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 120);
}

function chooseWorkspaceMode(manifest, route, requested = 'in-place') {
  if (requested === 'source') return 'in-place';
  if (requested === 'auto') {
    if (route.tier !== 0) return 'in-place';
    if (manifest.needs.trust === 'untrusted') return 'isolated-copy';
    return manifest.needs.capabilities.includes('fs-write') ? 'worktree' : 'in-place';
  }
  if (!WORKSPACE_MODES.has(requested)) {
    throw new Error(`Unsupported sandbox workspace mode: ${requested}`);
  }
  if (requested === 'worktree' && manifest.needs.trust === 'untrusted') {
    throw new Error('Untrusted jobs must use an isolated-copy workspace');
  }
  return requested;
}

function manifestAudiences(manifest) {
  return manifest.needs.capabilities
    .filter(capability => capability.startsWith('network:'))
    .map(capability => capability.slice('network:'.length))
    .filter(audience => audience !== '*' && !audience.startsWith('*.'))
    .sort();
}

function createFabricPlan(manifest, decision, options = {}) {
  const routes = (decision.routes || []).filter(route => route.result === 'routable');
  if (routes.length === 0) throw new Error('Execution fabric requires at least one routable job');
  const manifestPath = options.manifestPath || `${manifest.name}.yaml`;
  const credentialRequests = options.credentialRequests || [];
  const jobs = routes.map((route, index) => ({
    job_id: routeJobId(route, index),
    depends_on: [],
    manifest: manifestPath,
    trust: manifest.needs.trust,
    network_audience: manifestAudiences(manifest),
    workspace: { mode: chooseWorkspaceMode(manifest, route, options.workspaceMode || 'in-place') },
    route: {
      backend: route.backend,
      tier: route.tier,
      os: route.os,
      arch: route.arch,
    },
    credential_request_ids: credentialRequests
      .filter(request => request.job_id === routeJobId(route, index))
      .map(request => request.request_id),
  }));
  return executionFabric.contracts.validateExecutionPlan({
    schema_version: 1,
    plan_id: options.planId || `plan_${crypto.randomBytes(12).toString('hex')}`,
    created_at: options.createdAt || new Date().toISOString(),
    max_parallel: Math.max(1, Math.min(32, Math.floor(options.maxParallel || 1))),
    jobs,
    credential_requests: credentialRequests,
  });
}

function summarizeTrajectory(events, report, metrics = {}) {
  const phases = [];
  for (const event of events || []) {
    if (event.phase && phases.at(-1) !== event.phase) phases.push(event.phase);
  }
  const payload = {
    event_count: (events || []).length,
    phases,
    result: report?.result || null,
    evidence_complete: report?.install_diff?.complete === true,
    active_total_ms: metrics.active_total_ms || 0,
    review_wait_ms: metrics.review_wait_ms || 0,
    redactions: (events || []).reduce((total, event) => total + (event.redaction_count || 0), 0),
    truncated_events: (events || []).filter(event => event.truncated === true).length,
  };
  return { ...payload, sha256: sha256(JSON.stringify(payload)) };
}

module.exports = {
  WORKSPACE_MODES,
  chooseWorkspaceMode,
  createFabricPlan,
  executionFabric,
  summarizeTrajectory,
};
