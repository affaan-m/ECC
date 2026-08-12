const path = require('path');

const { SUPPORTED_INSTALL_TARGETS } = require('./install-manifests');
const { listInstallTargetAdapters } = require('./install-targets/registry');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function scope(id, targetId, root) {
  return { id, targetId, root };
}

function hooks(mode, eccConfigured, note) {
  return {
    mode,
    eccConfigured,
    note,
    summary: note,
  };
}

const HARNESS_CAPABILITIES = deepFreeze([
  {
    id: 'claude',
    label: 'Claude Code',
    targetIds: ['claude', 'claude-project'],
    channel: 'native-plugin',
    installMode: 'native-plugin',
    guidedReady: true,
    availability: 'guided',
    destination: 'Selected Claude plugin scope: ~/.claude or ./.claude',
    scopes: [
      scope('user', 'claude', '~/.claude'),
      scope('project', 'claude-project', './.claude'),
      scope('local', 'claude-project', './.claude'),
    ],
    hooks: hooks(
      'profile-selection',
      true,
      'ECC hooks are configured through the selected off, minimal, standard, or strict profile.'
    ),
    aliases: ['claude-code'],
  },
  {
    id: 'codex',
    label: 'Codex',
    targetIds: ['codex'],
    channel: 'native-plugin',
    installMode: 'native-plugin',
    guidedReady: true,
    availability: 'guided',
    destination: '~/.codex through the Codex native plugin lifecycle',
    scopes: [scope('native', 'codex', '~/.codex')],
    hooks: hooks(
      'native-trust',
      true,
      'ECC hooks use Codex native plugin discovery and remain subject to Codex review and trust.'
    ),
    aliases: ['openai-codex'],
  },
  {
    id: 'kimi',
    label: 'Kimi Code',
    targetIds: ['kimi'],
    channel: 'managed-project',
    installMode: 'managed-project',
    guidedReady: true,
    availability: 'guided',
    destination: './.kimi-code',
    scopes: [scope('project', 'kimi', './.kimi-code')],
    hooks: hooks(
      'not-configured',
      false,
      'ECC hooks are not configured for the Kimi managed-project install.'
    ),
    aliases: ['kimi-code'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    targetIds: ['cursor'],
    channel: 'managed-project',
    installMode: 'managed-project',
    guidedReady: false,
    availability: 'advanced',
    destination: './.cursor',
    scopes: [scope('project', 'cursor', './.cursor')],
    hooks: hooks(
      'adapter-configured',
      true,
      'ECC hooks use the Cursor project adapter and Cursor event configuration.'
    ),
    aliases: [],
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    targetIds: ['antigravity'],
    channel: 'managed-project',
    installMode: 'managed-project',
    guidedReady: false,
    availability: 'advanced',
    destination: './.agent',
    scopes: [scope('project', 'antigravity', './.agent')],
    hooks: hooks('not-configured', false, 'ECC hooks are not configured by this adapter.'),
    aliases: ['google-antigravity'],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    targetIds: ['gemini'],
    channel: 'managed-project',
    installMode: 'managed-project',
    guidedReady: false,
    availability: 'advanced',
    destination: './.gemini',
    scopes: [scope('project', 'gemini', './.gemini')],
    hooks: hooks('not-configured', false, 'ECC hooks are not configured by this adapter.'),
    aliases: ['gemini-cli'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    targetIds: ['opencode'],
    channel: 'managed-home',
    installMode: 'managed-home',
    guidedReady: false,
    availability: 'advanced',
    destination: '~/.opencode',
    scopes: [scope('home', 'opencode', '~/.opencode')],
    hooks: hooks(
      'adapter-opt-in',
      false,
      'ECC hook runtime support is available through the OpenCode adapter but is not installed by default.'
    ),
    aliases: ['open-code'],
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy',
    targetIds: ['codebuddy'],
    channel: 'managed-project',
    installMode: 'managed-project',
    guidedReady: false,
    availability: 'advanced',
    destination: './.codebuddy',
    scopes: [scope('project', 'codebuddy', './.codebuddy')],
    hooks: hooks(
      'managed-files',
      true,
      'ECC hook runtime files are installed through the CodeBuddy project adapter.'
    ),
    aliases: ['code-buddy'],
  },
  {
    id: 'joycode',
    label: 'JoyCode',
    targetIds: ['joycode'],
    channel: 'managed-project',
    installMode: 'managed-project',
    guidedReady: false,
    availability: 'advanced',
    destination: './.joycode',
    scopes: [scope('project', 'joycode', './.joycode')],
    hooks: hooks('not-configured', false, 'ECC hooks are not configured by this adapter.'),
    aliases: ['joy-code'],
  },
  {
    id: 'qwen',
    label: 'Qwen Code',
    targetIds: ['qwen'],
    channel: 'managed-home',
    installMode: 'managed-home',
    guidedReady: false,
    availability: 'advanced',
    destination: '~/.qwen',
    scopes: [scope('home', 'qwen', '~/.qwen')],
    hooks: hooks('not-configured', false, 'ECC hooks are not configured by this adapter.'),
    aliases: ['qwen-code'],
  },
  {
    id: 'zed',
    label: 'Zed',
    targetIds: ['zed'],
    channel: 'managed-project',
    installMode: 'managed-project',
    guidedReady: false,
    availability: 'advanced',
    destination: './.zed',
    scopes: [scope('project', 'zed', './.zed')],
    hooks: hooks('not-configured', false, 'ECC hooks are not configured by this adapter.'),
    aliases: [],
  },
  {
    id: 'hermes',
    label: 'Hermes',
    targetIds: ['hermes'],
    channel: 'managed-home',
    installMode: 'managed-home',
    guidedReady: false,
    availability: 'advanced',
    destination: '~/.hermes',
    scopes: [scope('home', 'hermes', '~/.hermes')],
    hooks: hooks('not-configured', false, 'ECC hooks are not configured by this adapter.'),
    aliases: ['hermes-agent'],
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    targetIds: ['openclaw'],
    channel: 'managed-home',
    installMode: 'managed-home',
    guidedReady: false,
    availability: 'advanced',
    destination: '~/.openclaw',
    scopes: [scope('home', 'openclaw', '~/.openclaw')],
    hooks: hooks('not-configured', false, 'ECC hooks are not configured by this adapter.'),
    aliases: ['open-claw'],
  },
]);

const GUIDED_HARNESS_IDS = deepFreeze(
  HARNESS_CAPABILITIES
    .filter(harness => harness.guidedReady)
    .map(harness => harness.id)
);

function normalizeLookupToken(value) {
  return String(value).trim().toLowerCase().replace(/[\s_]+/g, '-');
}

const LOOKUP = new Map();
for (const harness of HARNESS_CAPABILITIES) {
  const keys = [harness.id, harness.label, ...harness.targetIds, ...harness.aliases];
  for (const key of keys) {
    LOOKUP.set(normalizeLookupToken(key), harness);
  }
}

function expectedRootForAdapter(adapter) {
  const homeDir = path.resolve('/__ecc_catalog_home__');
  const projectRoot = path.resolve('/__ecc_catalog_project__');
  const absoluteRoot = adapter.resolveRoot({ homeDir, projectRoot });
  const baseRoot = adapter.kind === 'home' ? homeDir : projectRoot;
  const prefix = adapter.kind === 'home' ? '~/' : './';
  return `${prefix}${path.relative(baseRoot, absoluteRoot).replace(/\\/g, '/')}`;
}

function validateCatalog() {
  const adapters = listInstallTargetAdapters();
  const adapterByTarget = new Map(adapters.map(adapter => [adapter.target, adapter]));
  const catalogTargetIds = HARNESS_CAPABILITIES.flatMap(harness => harness.targetIds);

  if (new Set(catalogTargetIds).size !== catalogTargetIds.length) {
    throw new Error('Harness capability catalog contains duplicate install target ids');
  }

  const supported = [...SUPPORTED_INSTALL_TARGETS].sort();
  const registered = adapters.map(adapter => adapter.target).sort();
  const catalogued = [...catalogTargetIds].sort();
  if (
    JSON.stringify(catalogued) !== JSON.stringify(supported)
    || JSON.stringify(catalogued) !== JSON.stringify(registered)
  ) {
    throw new Error('Harness capability catalog is out of sync with install targets');
  }

  for (const harness of HARNESS_CAPABILITIES) {
    for (const declaredScope of harness.scopes) {
      const adapter = adapterByTarget.get(declaredScope.targetId);
      if (!adapter || expectedRootForAdapter(adapter) !== declaredScope.root) {
        throw new Error(
          `Harness capability root is out of sync for target ${declaredScope.targetId}`
        );
      }
    }
  }
}

validateCatalog();

function listHarnessCapabilities() {
  return HARNESS_CAPABILITIES.slice();
}

function listGuidedHarnesses() {
  return GUIDED_HARNESS_IDS.map(id => LOOKUP.get(id));
}

function getHarnessCapability(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  return LOOKUP.get(normalizeLookupToken(value)) || null;
}

function tokenizeSelection(selection) {
  const values = Array.isArray(selection) ? selection : [selection];
  return values.flatMap(value => (
    typeof value === 'string' ? value.split(',') : []
  )).map(value => value.trim()).filter(Boolean);
}

function normalizeHarnessSelection(selection) {
  const tokens = tokenizeSelection(selection);
  if (tokens.length === 0 || tokens.every(token => normalizeLookupToken(token) === 'none')) {
    throw new Error('At least one guided harness must be selected');
  }

  const allTokens = tokens.filter(token => ['all', '*'].includes(normalizeLookupToken(token)));
  const explicitTokens = tokens.filter(token => !['all', '*'].includes(normalizeLookupToken(token)));
  if (allTokens.length > 0 && explicitTokens.length > 0) {
    throw new Error('The all/* harness selection cannot be combined with other selections');
  }
  if (allTokens.length > 0) {
    return GUIDED_HARNESS_IDS.slice();
  }

  const selected = new Set();
  for (const token of tokens) {
    const normalizedToken = normalizeLookupToken(token);
    const menuIndex = /^\d+$/.test(normalizedToken) ? Number(normalizedToken) - 1 : -1;
    const harness = menuIndex >= 0
      ? listGuidedHarnesses()[menuIndex] || null
      : getHarnessCapability(token);

    if (!harness) {
      throw new Error(`Unknown guided harness selection: ${token}`);
    }
    if (!harness.guidedReady) {
      throw new Error(`${harness.label} is an advanced harness and is not guided-ready`);
    }
    selected.add(harness.id);
  }

  if (selected.size === 0) {
    throw new Error('At least one guided harness must be selected');
  }

  return GUIDED_HARNESS_IDS.filter(id => selected.has(id));
}

module.exports = {
  GUIDED_HARNESS_IDS,
  HARNESS_CAPABILITIES,
  getHarnessCapability,
  listGuidedHarnesses,
  listHarnessCapabilities,
  normalizeHarnessSelection,
};
