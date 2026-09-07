'use strict';

const os = require('os');
const { validateCapabilities } = require('./contracts');

const TARGET_OSES = ['linux', 'macos', 'windows'];

function normalizeOs(platform = process.platform) {
  const values = {
    darwin: 'macos',
    linux: 'linux',
    win32: 'windows',
  };
  return values[platform] || platform;
}

function normalizeArch(architecture = process.arch) {
  const values = {
    arm64: 'arm64',
    x64: 'x86_64',
  };
  return values[architecture] || architecture;
}

function defaultHost() {
  return {
    os: normalizeOs(),
    arch: normalizeArch(),
    cpus: os.cpus().length,
  };
}

function expandTargets(manifest, host) {
  // DECISION: CONVENTIONS item 1 makes routing a deterministic shard plan.
  const requestedOs = manifest.needs.os;
  let osTargets;
  if (requestedOs[0] === 'any') {
    osTargets = [host.os];
  } else if (requestedOs[0] === 'all') {
    osTargets = TARGET_OSES;
  } else {
    osTargets = requestedOs;
  }

  const archTargets = manifest.needs.arch || [host.arch];
  return osTargets.flatMap(targetOs => (
    archTargets.map(arch => ({ os: targetOs, arch }))
  ));
}

function backendEntry(capabilities, backend) {
  return capabilities.backends?.[backend] || { available: false };
}

function targetMatches(target, shard) {
  return target.os === shard.os && (target.arch === undefined || target.arch === shard.arch);
}

function backendSupports(capabilities, backend, shard, manifest) {
  const entry = backendEntry(capabilities, backend);
  if (!entry.available) return false;
  const host = capabilities.host;
  const hardConstraints = {
    srt: shard.os === host.os && shard.arch === host.arch,
  };
  if (!hardConstraints[backend]) return false;
  if (Array.isArray(entry.targets) && !entry.targets.some(target => targetMatches(target, shard))) {
    return false;
  }
  if (
    manifest.needs.capabilities.includes('ios-simulator')
    && !entry.capabilities?.includes('ios-simulator')
  ) {
    return false;
  }
  if (
    networkNeeds(manifest).domainAllowlist
    && !entry.capabilities?.includes('domain-network-policy')
  ) {
    return false;
  }
  return true;
}

function networkNeeds(manifest) {
  const values = manifest.needs.capabilities.filter(value => value.startsWith('network:'));
  return {
    requested: values.length > 0,
    open: values.includes('network:*'),
    domainAllowlist: values.length > 0 && !values.includes('network:*'),
  };
}

function hasAny(manifest, values) {
  return values.some(value => manifest.needs.capabilities.includes(value));
}

function tierZeroEligible(manifest, shard, host) {
  // DECISION: CONVENTIONS item 8 treats clean-home as environment isolation.
  // DECISION: CONVENTIONS item 17 routes network:* around SRT because its
  // current allowlist schema cannot express unrestricted egress.
  return (
    shard.os === host.os
    && shard.arch === host.arch
    && manifest.needs.native === false
    && !networkNeeds(manifest).open
    && !hasAny(manifest, [
      'pkg-install',
      'services',
      'gui',
      'clean-home',
      'ios-simulator',
    ])
  );
}

function firstSupported(candidates, capabilities, shard, manifest) {
  return candidates.find(backend => backendSupports(capabilities, backend, shard, manifest)) || null;
}

function missingRoute(shard) {
  return {
    reason: `no implemented Tier 0 backend satisfies ${shard.os}/${shard.arch}`,
    fix: 'Use a Tier 0-compatible host process claim or install the separate Tier 1 Podman feature',
  };
}

function resolveShard(manifest, capabilities, shard, _options = {}) {
  const host = capabilities.host;
  const rules = [
    {
      id: 'tier-0-process',
      tier: 0,
      eligible: () => tierZeroEligible(manifest, shard, host),
      candidates: () => ['srt'],
      reason: 'host-matching process isolation satisfies the declared needs',
    },
  ];

  for (const rule of rules) {
    if (!rule.eligible()) continue;
    const candidates = rule.candidates();
    const backend = firstSupported(candidates, capabilities, shard, manifest);
    if (!backend) continue;
    return {
      os: shard.os,
      arch: shard.arch,
      backend,
      tier: rule.tier,
      rule: rule.id,
      reason: rule.reason,
      notes: [],
      result: 'routable',
    };
  }

  return {
    os: shard.os,
    arch: shard.arch,
    backend: null,
    tier: null,
    rule: null,
    ...missingRoute(shard),
    notes: [],
    result: 'error',
  };
}

function routeManifest(manifest, capabilities, options = {}) {
  validateCapabilities(capabilities);
  const routes = expandTargets(manifest, capabilities.host)
    .map(shard => resolveShard(manifest, capabilities, shard, options));
  return {
    schema_version: 1,
    manifest: options.manifestPath || null,
    host: { ...capabilities.host },
    routes,
    result: routes.every(route => route.result === 'routable') ? 'routable' : 'error',
  };
}

module.exports = {
  TARGET_OSES,
  defaultHost,
  expandTargets,
  networkNeeds,
  normalizeArch,
  normalizeOs,
  resolveShard,
  routeManifest,
};
