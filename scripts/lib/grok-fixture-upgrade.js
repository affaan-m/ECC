'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA = 'ecc.grok-fixture.v1';

const EXCLUSIVE_FIXTURE_PATHS = [
  '.grok/AGENTS.md',
  '.grok/agents/docs-researcher.md',
  '.grok/agents/explorer.md',
  '.grok/agents/reviewer.md',
  'docs/GROK-NAVIGATION-GUIDE.md',
  'scripts/sync-ecc-to-grok.sh',
  'scripts/grok/check-grok-global-state.sh',
  'scripts/grok/check-grok-fixture.js',
  'scripts/grok/generate-command-file.js',
  'scripts/grok/install-agents-skills.js',
  'scripts/grok/install-grok-commands.js',
  'tests/docs/grok-navigation-map.test.js',
  'tests/scripts/generate-command-file.test.js',
  'tests/scripts/install-agents-skills.test.js',
  'tests/scripts/install-grok-commands.test.js',
  'tests/scripts/sync-ecc-to-grok.test.js',
];

const SHARED_FIXTURE_MARKERS = [
  { file: 'scripts/codex/merge-mcp-config.js', pattern: /--harness grok/ },
  { file: 'scripts/codex/legacy-sync-state.js', pattern: /--grok-home/ },
  { file: 'scripts/codex/install-global-git-hooks.sh', pattern: /dirname "\$DEST_DIR"\)\/backups/ },
  { file: 'scripts/lib/codex-legacy-sync.js', pattern: /extraTrustedRoots/ },
  { file: 'README.md', pattern: /### Grok Build/ },
  { file: 'CONTRIBUTING.md', pattern: /Grok Build/ },
  { file: 'package.json', pattern: /scripts\/sync-ecc-to-grok\.sh/ },
];

const FIXTURE_PATH_SET = new Set([
  ...EXCLUSIVE_FIXTURE_PATHS,
  ...SHARED_FIXTURE_MARKERS.map(marker => marker.file),
]);

function readOptionalUtf8(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function getPolicyPath(grokHome) {
  return path.join(grokHome, 'ecc', 'fixture-policy.json');
}

function readFixturePolicy(grokHome) {
  const raw = readOptionalUtf8(getPolicyPath(grokHome));
  if (!raw) return null;
  try {
    const policy = JSON.parse(raw);
    if (policy.schema !== SCHEMA) return null;
    return policy;
  } catch {
    return null;
  }
}

function writeFixturePolicy(grokHome, patch) {
  const previous = readFixturePolicy(grokHome) || {};
  const policy = {
    schema: SCHEMA,
    status: patch.status || previous.status || 'active',
    lastFlow: patch.lastFlow || previous.lastFlow || null,
    lastReason: patch.lastReason || previous.lastReason || null,
    cleanup: patch.cleanup || previous.cleanup || null,
    probes: patch.probes || previous.probes || null,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(getPolicyPath(grokHome)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(getPolicyPath(grokHome), `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  return policy;
}

function detectDestFixture(grokHome) {
  if (!grokHome) return false;
  const policy = readFixturePolicy(grokHome);
  if (policy && policy.status === 'active') return true;
  if (fs.existsSync(path.join(grokHome, 'ecc', 'legacy-sync-state.json'))) return true;
  const agents = readOptionalUtf8(path.join(grokHome, 'AGENTS.md'));
  return Boolean(agents && agents.includes('Grok Supplement (From ECC .grok/AGENTS.md)'));
}

function probeGrokSupportFromGit(options) {
  const execute = options.execute;
  const repoRoot = options.repoRoot;
  const ref = options.ref || 'FETCH_HEAD';
  const show = (relativePath) => {
    try {
      const result = execute('git', ['show', `${ref}:${relativePath}`], { cwd: repoRoot });
      return String(result.stdout || '');
    } catch {
      return '';
    }
  };
  const exists = (relativePath) => {
    try {
      execute('git', ['cat-file', '-e', `${ref}:${relativePath}`], { cwd: repoRoot });
      return true;
    } catch {
      return false;
    }
  };
  const installManifests = show('scripts/lib/install-manifests.js');
  const mcpMerge = show('scripts/codex/merge-mcp-config.js');
  return {
    installTarget: /SUPPORTED_INSTALL_TARGETS\s*=\s*\[[^\]]*'grok'/.test(installManifests),
    copiedSync: exists('scripts/sync-ecc-to-grok.sh'),
    plugin: exists('.grok-plugin/plugin.json'),
    mcpHarness: mcpMerge.includes('--harness grok'),
  };
}

function probeGrokSupport(treeRoot) {
  const installManifests = readOptionalUtf8(path.join(treeRoot, 'scripts', 'lib', 'install-manifests.js')) || '';
  const mcpMerge = readOptionalUtf8(path.join(treeRoot, 'scripts', 'codex', 'merge-mcp-config.js')) || '';
  return {
    installTarget: /SUPPORTED_INSTALL_TARGETS\s*=\s*\[[^\]]*'grok'/.test(installManifests),
    copiedSync: fs.existsSync(path.join(treeRoot, 'scripts', 'sync-ecc-to-grok.sh')),
    plugin: fs.existsSync(path.join(treeRoot, '.grok-plugin', 'plugin.json')),
    mcpHarness: mcpMerge.includes('--harness grok'),
  };
}

function incomingSolvesFixture(incoming) {
  return Boolean(incoming && (incoming.installTarget || incoming.plugin));
}

function incomingAbsorbsOverlay(incoming) {
  return Boolean(incoming && incoming.copiedSync && incoming.mcpHarness);
}

function isFixtureNecessary(options) {
  if (!options.destPresent) return false;
  if (incomingSolvesFixture(options.incoming)) return false;
  return true;
}

function incomingTouchesFixture(changedPaths) {
  return (Array.isArray(changedPaths) ? changedPaths : []).some((changedPath) => {
    const normalized = String(changedPath).replace(/\\/g, '/');
    return FIXTURE_PATH_SET.has(normalized)
      || normalized === '.grok'
      || normalized.startsWith('.grok/');
  });
}

function classifyGrokFixtureUpgrade(options) {
  const destPresent = Boolean(options.destPresent);
  const policyStatus = options.policyStatus || null;
  const incoming = options.incoming || {};
  const changedPaths = options.changedPaths || [];

  if (policyStatus === 'detached') {
    return { flow: 'none', reason: 'detached', cleanup: null };
  }
  if (!destPresent && policyStatus !== 'active') {
    return { flow: 'none', reason: 'no-fixture', cleanup: null };
  }
  if (incomingSolvesFixture(incoming)) {
    return { flow: 'solved', reason: 'native-grok-support', cleanup: 'native' };
  }
  if (incomingAbsorbsOverlay(incoming)) {
    return { flow: 'solved', reason: 'overlay-absorbed', cleanup: 'absorbed' };
  }
  if (incomingTouchesFixture(changedPaths)) {
    return { flow: 'perforated', reason: 'incoming-touches-unsolved-fixture', cleanup: null };
  }
  return { flow: 'passthrough', reason: 'incoming-misses-fixture-paths', cleanup: null };
}

function snapshotFixtureFiles(repoRoot) {
  const files = {};
  for (const relativePath of EXCLUSIVE_FIXTURE_PATHS) {
    const content = readOptionalUtf8(path.join(repoRoot, relativePath));
    if (content !== null) files[relativePath] = content;
  }
  for (const marker of SHARED_FIXTURE_MARKERS) {
    const content = readOptionalUtf8(path.join(repoRoot, marker.file));
    if (content !== null) files[marker.file] = content;
  }
  return { createdAt: new Date().toISOString(), files };
}

function restoreFixtureSnapshot(repoRoot, snapshot) {
  const restored = { exclusive: [], shared: [] };
  const files = snapshot && snapshot.files ? snapshot.files : {};

  for (const relativePath of EXCLUSIVE_FIXTURE_PATHS) {
    if (typeof files[relativePath] !== 'string') continue;
    const dest = path.join(repoRoot, relativePath);
    if (readOptionalUtf8(dest) === files[relativePath]) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[relativePath]);
    restored.exclusive.push(relativePath);
  }

  for (const marker of SHARED_FIXTURE_MARKERS) {
    if (typeof files[marker.file] !== 'string') continue;
    const dest = path.join(repoRoot, marker.file);
    const current = readOptionalUtf8(dest);
    if (current && marker.pattern.test(current)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[marker.file]);
    restored.shared.push(marker.file);
  }

  return restored;
}

function listChangedPaths(execute, repoRoot, fromRef, toRef) {
  try {
    const result = execute('git', ['diff', '--name-only', `${fromRef}...${toRef}`], { cwd: repoRoot });
    return String(result.stdout || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function applyGrokFixtureUpgrade(options) {
  const {
    decision,
    repoRoot,
    grokHome,
    snapshot = null,
    dryRun = false,
  } = options;
  const result = {
    flow: decision.flow,
    reason: decision.reason,
    cleanup: decision.cleanup,
    restored: { exclusive: [], shared: [] },
    policy: null,
    destSync: 'skipped',
  };

  if (decision.flow === 'none' || dryRun) {
    return result;
  }

  if (decision.flow === 'perforated' && snapshot) {
    result.restored = restoreFixtureSnapshot(repoRoot, snapshot);
  }

  if (decision.flow === 'solved') {
    result.policy = writeFixturePolicy(grokHome, {
      status: 'detached',
      lastFlow: 'solved',
      lastReason: decision.reason,
      cleanup: decision.cleanup,
    });
    return result;
  }

  result.policy = writeFixturePolicy(grokHome, {
    status: 'active',
    lastFlow: decision.flow,
    lastReason: decision.reason,
  });
  return result;
}

module.exports = {
  EXCLUSIVE_FIXTURE_PATHS,
  SHARED_FIXTURE_MARKERS,
  SCHEMA,
  applyGrokFixtureUpgrade,
  classifyGrokFixtureUpgrade,
  detectDestFixture,
  getPolicyPath,
  incomingTouchesFixture,
  isFixtureNecessary,
  listChangedPaths,
  probeGrokSupport,
  probeGrokSupportFromGit,
  readFixturePolicy,
  restoreFixtureSnapshot,
  snapshotFixtureFiles,
  writeFixturePolicy,
};
