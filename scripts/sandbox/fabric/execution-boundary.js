'use strict';

const PROCESS_BACKENDS = new Set(['srt', 'ci-native', 'ci']);
const CONTAINER_BACKENDS = new Set(['podman', 'microsandbox']);
const VM_BACKENDS = new Set(['lume', 'lima', 'tart']);
const HOSTED_BACKENDS = new Set(['ci-native', 'ci']);

function executionClass(backend) {
  if (PROCESS_BACKENDS.has(backend)) return 'restricted-process';
  if (CONTAINER_BACKENDS.has(backend)) return 'disposable-container';
  if (VM_BACKENDS.has(backend)) return 'disposable-vm';
  throw new Error(`Execution fabric cannot classify backend ${backend}`);
}

function controlsFor(backend) {
  if (backend === 'srt') {
    return {
      enforced: [
        'exact filesystem and process policy',
        'controller-owned runtime deadline',
        'bounded command output',
      ],
      missing: ['whole-agent containment', 'guest-kernel isolation'],
      limits: [
        'dynamic CPU, memory, and process telemetry may be unavailable',
        'storage telemetry covers the controller-owned workspace',
      ],
    };
  }
  if (CONTAINER_BACKENDS.has(backend)) {
    return {
      enforced: [
        'disposable task-owned writable state',
        'backend CPU and memory limits',
        'declared network mode',
        'controller-owned runtime deadline',
        'verified resource cleanup',
      ],
      missing: ['whole-agent containment'],
      limits: [
        'provider spend telemetry is unavailable for local execution',
        'storage telemetry covers the controller-owned workspace',
      ],
    };
  }
  if (VM_BACKENDS.has(backend)) {
    return {
      enforced: [
        'separate guest kernel',
        'immutable guest identity',
        'backend CPU and memory limits',
        'controller-owned runtime deadline',
        'verified resource cleanup',
      ],
      missing: ['whole-agent containment', 'destination-specific egress enforcement'],
      limits: [
        'provider spend telemetry is unavailable for local execution',
        'storage telemetry covers the controller-owned workspace',
      ],
    };
  }
  return {
    enforced: [
      'first-party workflow trust gate',
      'exact command transcript',
      'controller-owned runtime deadline',
      'artifact identity verification',
    ],
    missing: ['whole-agent containment', 'verified underlying runner isolation class'],
    limits: [
      'hosted runner resource telemetry depends on the placement provider',
      'storage telemetry covers the controller-owned workspace',
    ],
  };
}

function buildExecutionBoundary(route) {
  const backend = route?.backend;
  const controls = controlsFor(backend);
  const hosted = HOSTED_BACKENDS.has(backend);
  return {
    schema_version: 1,
    execution_class: executionClass(backend),
    placement: hosted ? 'hosted' : 'local',
    operator: hosted ? 'github-actions' : 'ecc-local-host',
    coverage: {
      scope: 'shell-only',
      complete: true,
      contained_surfaces: ['shell', 'child-processes'],
      excluded_surfaces: [
        'filesystem-tools', 'hooks', 'plugins', 'browsers', 'mcp-servers',
        'model-api-clients', 'network-clients',
      ],
      brokered_interfaces: [],
    },
    enforced_controls: controls.enforced,
    missing_controls: controls.missing,
    evidence_limits: controls.limits,
  };
}

module.exports = { buildExecutionBoundary, executionClass };
