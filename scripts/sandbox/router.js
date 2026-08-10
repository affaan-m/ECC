'use strict';

const os = require('os');
const { validateCapabilities } = require('./contracts');

const TARGET_OSES = ['linux', 'macos', 'windows'];
const TIER_TWO_BACKENDS = {
  linux: ['lima'],
  macos: ['lume', 'tart'],
  windows: ['windows-sandbox', 'hyper-v', 'dockur-windows'],
};

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
    podman: shard.os === 'linux' && shard.arch === host.arch,
    docker: shard.os === 'linux' && shard.arch === host.arch,
    microsandbox: shard.os === 'linux' && shard.arch === host.arch,
    lume: host.os === 'macos' && host.arch === 'arm64' && shard.os === 'macos' && shard.arch === 'arm64',
    // DECISION: CONVENTIONS item 14 permits a real Lima Linux guest on macOS.
    lima: ['linux', 'macos'].includes(host.os) && shard.os === 'linux' && shard.arch === host.arch,
    tart: host.os === 'macos' && host.arch === 'arm64' && shard.os === 'macos' && shard.arch === 'arm64',
    // DECISION: CONVENTIONS item 12 keeps local Windows execution disabled in
    // v1 even if a supplied capability map claims the detected tools are ready.
    'windows-sandbox': false,
    'hyper-v': false,
    'dockur-windows': false,
    'ci-native': shard.os === host.os && shard.arch === host.arch,
    ci: Array.isArray(entry.targets) && entry.targets.some(target => targetMatches(target, shard)),
  };
  if (!hardConstraints[backend]) return false;
  const network = networkNeeds(manifest);
  // DECISION: CONVENTIONS item 32 fails closed before local VM execution:
  // none of the v1 adapters provides a complete no-network boundary, so
  // unrestricted networking must be explicit rather than a post-run surprise.
  if (['lume', 'lima', 'tart'].includes(backend) && !network.open) return false;
  // DECISION: CONVENTIONS item 37 keeps hosted native execution fail-closed:
  // v1 cannot preserve disabled/domain-only egress, and its report boundary is
  // intentionally unavailable to untrusted commands.
  if (
    ['ci', 'ci-native'].includes(backend)
    && (!network.open || manifest.needs.trust !== 'first-party')
  ) return false;
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
    network.domainAllowlist
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

function tierOneEligible(manifest, shard) {
  // DECISION: CONVENTIONS item 2 keeps native service/GUI evidence out of containers.
  return (
    shard.os === 'linux'
    && manifest.needs.native === false
    && !hasAny(manifest, ['services', 'gui', 'ios-simulator'])
  );
}

function tierOneCandidates(manifest) {
  const network = networkNeeds(manifest);
  // DECISION: CONVENTIONS item 9 fails closed on unenforced domain allowlists.
  if (network.domainAllowlist) return ['microsandbox'];
  if (manifest.needs.trust === 'untrusted' || network.open) {
    return ['microsandbox', 'podman', 'docker'];
  }
  return ['podman', 'docker'];
}

function tierTwoCandidates(shard) {
  return TIER_TWO_BACKENDS[shard.os] || [];
}

function firstSupported(candidates, capabilities, shard, manifest) {
  return candidates.find(backend => backendSupports(capabilities, backend, shard, manifest)) || null;
}

function routeNotes(backend, manifest) {
  const notes = [];
  const network = networkNeeds(manifest);
  if (
    ['podman', 'docker'].includes(backend)
    && (manifest.needs.trust === 'untrusted' || network.open)
  ) {
    const fallbackName = backend === 'podman' ? 'Podman' : 'Docker';
    notes.push(`microsandbox unavailable; using documented degraded ${fallbackName} isolation`);
  }
  if (['podman', 'docker'].includes(backend) && network.open) {
    notes.push('Tier 1 container v1 network policy is unrestricted for network:*');
  }
  if (backend === 'docker') {
    notes.push('Podman unavailable; using an already-installed Docker fallback (Docker Desktop is never required or recommended)');
  }
  if (backend === 'tart') {
    notes.push('Tart uses Fair Source 100 licensing; personal use is free, while some large organizational server installations require a paid license');
  }
  return notes;
}

function missingRoute(shard, manifest, capabilities, localOnly) {
  const network = networkNeeds(manifest);
  if (
    !network.requested
    && tierTwoCandidates(shard).some(backend => backendEntry(capabilities, backend).available)
  ) {
    return {
      reason: `local ${shard.os}/${shard.arch} VM backends cannot enforce no-network isolation in v1`,
      fix: 'Add network:* only after accepting unrestricted guest egress, or choose a venue with the required network boundary',
    };
  }
  if (
    network.domainAllowlist
    && tierOneEligible(manifest, shard)
    && !backendSupports(capabilities, 'microsandbox', shard, manifest)
  ) {
    return {
      reason: 'strict domain allowlists require a probed microsandbox with domain-network-policy in Tier 1 v1',
      fix: 'Install pinned Microsandbox: cargo install microsandbox-cli --version 0.6.8 --locked',
    };
  }
  if (network.domainAllowlist) {
    return {
      reason: `no ${shard.os}/${shard.arch} native or CI backend enforces strict domain allowlists in v1`,
      fix: 'Target Linux with microsandbox, or remove native OS needs after reviewing the network policy',
    };
  }
  if (
    !localOnly
    && backendEntry(capabilities, 'ci').available
    && manifest.needs.trust === 'untrusted'
  ) {
    return {
      reason: 'CI-native v1 cannot produce trustworthy evidence for untrusted commands',
      fix: 'Target an available local hardened backend, or keep the untrusted test on Linux Tier 1',
    };
  }
  if (!localOnly && backendEntry(capabilities, 'ci').available && !network.open) {
    return {
      reason: 'CI-native v1 cannot enforce disabled egress',
      fix: 'Add network:* only after accepting hosted-runner egress, or use a local backend that preserves the requested boundary',
    };
  }
  if (!localOnly && !backendEntry(capabilities, 'ci').available) {
    return {
      reason: `no local backend satisfies ${shard.os}/${shard.arch}, and GitHub CLI authentication is unavailable`,
      fix: 'Enable CI fallback: gh auth login',
    };
  }
  if (localOnly) {
    return {
      reason: `no local backend satisfies ${shard.os}/${shard.arch}`,
      fix: 'Remove --local-only or install the native backend reported by ecc-sandbox probe',
    };
  }
  return {
    reason: `no available backend satisfies ${shard.os}/${shard.arch}`,
    fix: 'Run ecc-sandbox probe --refresh and enable one of the reported backend setup commands',
  };
}

function resolveShard(manifest, capabilities, shard, options = {}) {
  const host = capabilities.host;
  const network = networkNeeds(manifest);

  const rules = [
    {
      id: 'ci-native-forced',
      tier: 3,
      // DECISION: CONVENTIONS item 36 makes the checked-in sandbox matrix force its native
      // runner so an under-declared command that escalated from Tier 1 cannot
      // be routed straight back into another container on the hosted runner.
      eligible: () => options.forceCiNative === true && !network.domainAllowlist,
      candidates: () => ['ci-native'],
      reason: 'the sandbox matrix explicitly requires execution on its native hosted runner',
    },
    {
      id: 'tier-0-process',
      tier: 0,
      eligible: () => options.forceCiNative !== true && tierZeroEligible(manifest, shard, host),
      candidates: () => ['srt'],
      reason: 'host-matching process isolation satisfies the declared needs',
    },
    {
      id: 'tier-1-ephemeral',
      tier: 1,
      eligible: () => options.forceCiNative !== true && tierOneEligible(manifest, shard),
      candidates: () => tierOneCandidates(manifest),
      reason: 'an ephemeral Linux environment is the cheapest clean venue for the declared needs',
    },
    {
      id: 'ci-native-runner',
      tier: 3,
      // DECISION: CONVENTIONS item 26 exposes the already-disposable hosted
      // runner only behind an explicit workflow capability. Inside that
      // workflow it must win over incidental VM tooling on the runner image.
      eligible: () => options.forceCiNative !== true && !network.domainAllowlist,
      candidates: () => ['ci-native'],
      reason: 'the explicitly enabled disposable GitHub runner is native to the target OS',
    },
    {
      id: 'tier-2-native',
      tier: 2,
      eligible: () => options.forceCiNative !== true && !network.domainAllowlist,
      candidates: () => tierTwoCandidates(shard),
      reason: 'OS-native behavior requires a local full VM',
    },
    {
      id: 'ci-fallback',
      tier: 3,
      eligible: () => (
        options.forceCiNative !== true
        && !options.localOnly
        && !network.domainAllowlist
      ),
      candidates: () => ['ci'],
      reason: 'the requested OS or native capability is unavailable locally',
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
      notes: routeNotes(backend, manifest),
      result: 'routable',
    };
  }

  if (options.forceCiNative === true) {
    let forcedReason = 'the sandbox matrix forced native execution but ci-native is unavailable';
    let forcedFix = 'Run only inside the checked-in sandbox matrix with GITHUB_ACTIONS=true and ECC_SANDBOX_CI_NATIVE=1';
    if (manifest.needs.trust === 'untrusted') {
      forcedReason = 'the sandbox matrix refuses untrusted CI-native execution in v1';
      forcedFix = 'Run untrusted code in a local hardened Tier 1 backend';
    } else if (!network.open) {
      forcedReason = 'the sandbox matrix requires explicit network:* because its native runner cannot disable egress';
      forcedFix = 'Add network:* only after accepting hosted-runner egress';
    }
    return {
      os: shard.os,
      arch: shard.arch,
      backend: null,
      tier: null,
      rule: null,
      reason: forcedReason,
      fix: forcedFix,
      notes: [],
      result: 'error',
    };
  }

  return {
    os: shard.os,
    arch: shard.arch,
    backend: null,
    tier: null,
    rule: null,
    ...missingRoute(shard, manifest, capabilities, options.localOnly),
    notes: [],
    result: 'error',
  };
}

function resolveTierOneFallback(manifest, capabilities, shard, options = {}) {
  // DECISION: CONVENTIONS item 25 keeps startup fallback within Tier 1 and
  // reuses the same table-driven eligibility and network-policy checks.
  if (!tierOneEligible(manifest, shard)) {
    return {
      ...shard,
      backend: null,
      tier: null,
      rule: null,
      reason: 'the target is not eligible for a Tier 1 ephemeral environment',
      fix: 'Declare Linux non-native needs, or enable the required native/CI backend',
      notes: [],
      result: 'error',
    };
  }
  const excluded = new Set(options.exclude || []);
  const candidates = tierOneCandidates(manifest).filter(backend => !excluded.has(backend));
  const backend = firstSupported(candidates, capabilities, shard, manifest);
  if (!backend) {
    const missing = missingRoute(shard, manifest, capabilities, true);
    return {
      ...shard,
      backend: null,
      tier: null,
      rule: null,
      ...missing,
      notes: [],
      result: 'error',
    };
  }
  return {
    ...shard,
    backend,
    tier: 1,
    rule: options.rule || 'tier-1-runtime-fallback',
    reason: options.reason || 'the preferred Tier 1 backend could not start',
    notes: routeNotes(backend, manifest),
    result: 'routable',
  };
}

function resolveRuntimeEscalation(manifest, capabilities, sourceRoute, options = {}) {
  // DECISION: CONVENTIONS item 24 permits one SRT denial rerun; `any` may move
  // from the native host process to a Linux ephemeral environment.
  // DECISION: CONVENTIONS item 36 permits one cleanup-gated container rerun on
  // a native local guest or the forced-native hosted runner.
  const shard = {
    os: manifest.needs.os[0] === 'any' ? 'linux' : sourceRoute.os,
    arch: sourceRoute.arch,
  };
  if (sourceRoute.backend === 'srt') {
    return resolveTierOneFallback(manifest, capabilities, shard, {
      ...options,
      rule: 'runtime-tier-1-escalation',
      reason: 'an installer or system-write denial requires one ephemeral rerun',
    });
  }

  if (['podman', 'docker', 'microsandbox'].includes(sourceRoute.backend)) {
    const nativeBackend = firstSupported(
      tierTwoCandidates(shard),
      capabilities,
      shard,
      manifest
    );
    if (nativeBackend) {
      return {
        ...shard,
        backend: nativeBackend,
        tier: 2,
        rule: 'runtime-tier-2-escalation',
        reason: 'a high-confidence container failure requires native OS behavior',
        notes: routeNotes(nativeBackend, manifest),
        result: 'routable',
      };
    }

    if (!options.localOnly && backendSupports(capabilities, 'ci', shard, manifest)) {
      return {
        ...shard,
        backend: 'ci',
        tier: 3,
        rule: 'runtime-ci-escalation',
        reason: 'native OS behavior is unavailable locally and requires hosted CI',
        notes: [],
        result: 'routable',
      };
    }

    const missing = missingRoute(shard, manifest, capabilities, options.localOnly === true);
    return {
      ...shard,
      backend: null,
      tier: null,
      rule: null,
      ...missing,
      notes: [],
      result: 'error',
    };
  }

  return {
    ...shard,
    backend: null,
    tier: null,
    rule: null,
    reason: 'only a Tier 0 SRT or Tier 1 container result can escalate',
    fix: 'Correct the manifest needs or inspect the selected backend report',
    notes: [],
    result: 'error',
  };
}

function routeManifest(manifest, capabilities, options = {}) {
  validateCapabilities(capabilities);
  let shards = expandTargets(manifest, capabilities.host);
  if (options.shard) {
    shards = shards.filter(shard => (
      shard.os === options.shard.os && shard.arch === options.shard.arch
    ));
    if (shards.length !== 1) {
      throw new Error(
        `requested shard ${options.shard.os}/${options.shard.arch} is not declared by the manifest`
      );
    }
  }
  const routes = shards
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
  TIER_TWO_BACKENDS,
  defaultHost,
  expandTargets,
  networkNeeds,
  normalizeArch,
  normalizeOs,
  resolveShard,
  resolveRuntimeEscalation,
  resolveTierOneFallback,
  routeManifest,
  tierOneCandidates,
};
