'use strict';

const fs = require('fs');
const path = require('path');

const MATRIX_BLOCK_START = '<!-- harness-adapter-compliance:matrix-start -->';
const MATRIX_BLOCK_END = '<!-- harness-adapter-compliance:matrix-end -->';

const COMPLIANCE_STATES = Object.freeze({
  Native: 'ECC can install or verify the surface directly for this harness.',
  'Adapter-backed': 'ECC has a thin adapter, plugin, or package surface, but parity differs by harness.',
  'Instruction-backed': 'ECC can provide the guidance and files, but the harness does not expose the runtime hook/session surface ECC needs for enforcement.',
  'Reference-only': 'The tool is useful as a design pressure or external runtime, but ECC does not yet ship a direct installer or adapter for it.',
});

const REQUIRED_FIELDS = Object.freeze([
  'id',
  'harness',
  'state',
  'supported_assets',
  'unsupported_surfaces',
  'install_or_onramp',
  'verification_commands',
  'risk_notes',
  'last_verified_at',
  'owner',
  'source_docs',
]);

function freezeRecord(record) {
  return Object.freeze({
    ...record,
    supported_assets: Object.freeze(record.supported_assets.slice()),
    unsupported_surfaces: Object.freeze(record.unsupported_surfaces.slice()),
    install_or_onramp: Object.freeze(record.install_or_onramp.slice()),
    verification_commands: Object.freeze(record.verification_commands.slice()),
    risk_notes: Object.freeze(record.risk_notes.slice()),
    source_docs: Object.freeze(record.source_docs.slice()),
  });
}

const ADAPTER_RECORDS = Object.freeze([
  {
    id: 'claude-code',
    harness: 'Claude Code',
    state: 'Native',
    supported_assets: [
      'Claude plugin assets',
      'skills',
      'commands',
      'hooks',
      'MCP config',
      'local rules',
      'statusline-oriented workflows',
    ],
    unsupported_surfaces: ['Claude-native hooks do not imply parity in other harnesses'],
    install_or_onramp: [
      '`./install.sh --profile minimal --target claude`',
      'Claude plugin install',
    ],
    verification_commands: [
      '`npm run harness:audit -- --format json`',
      '`node scripts/session-inspect.js --list-adapters`',
    ],
    risk_notes: ['Avoid loading every skill by default; keep hooks opt-in and inspectable.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      '.claude-plugin/plugin.json',
      'docs/architecture/cross-harness.md',
      'scripts/lib/install-targets/claude-home.js',
    ],
  },
  {
    id: 'codex',
    harness: 'Codex',
    state: 'Instruction-backed',
    supported_assets: [
      '`AGENTS.md`',
      'Codex plugin metadata',
      'skills',
      'MCP reference config',
      'command patterns',
    ],
    unsupported_surfaces: ['Native hook enforcement and Claude slash-command semantics are not equivalent'],
    install_or_onramp: [
      '`./install.sh --profile minimal --target codex`',
      'repo-local `AGENTS.md` review',
    ],
    verification_commands: ['`npm run harness:audit -- --format json`'],
    risk_notes: ['Treat hooks as policy text unless a native Codex hook surface exists.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      '.codex-plugin/plugin.json',
      'AGENTS.md',
      'scripts/lib/install-targets/codex-home.js',
    ],
  },
  {
    id: 'opencode',
    harness: 'OpenCode',
    state: 'Adapter-backed',
    supported_assets: [
      'OpenCode package/plugin metadata',
      'shared skills',
      'MCP config',
      'event adapter patterns',
    ],
    unsupported_surfaces: ['Event names, plugin packaging, and command dispatch differ from Claude Code'],
    install_or_onramp: ['OpenCode package or plugin surface from this repo'],
    verification_commands: [
      '`node tests/scripts/build-opencode.test.js`',
      '`npm run harness:audit -- --format json`',
    ],
    risk_notes: ['Keep hook logic in shared scripts and adapt only event shape at the edge.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      '.opencode/package.json',
      '.opencode/plugins/ecc-hooks.ts',
      'scripts/build-opencode.js',
    ],
  },
  {
    id: 'cursor',
    harness: 'Cursor',
    state: 'Adapter-backed',
    supported_assets: [
      'Cursor rules',
      'project-local skills',
      'hook adapter',
      'shared scripts',
    ],
    unsupported_surfaces: ['Cursor hook events and rule loading differ from Claude Code'],
    install_or_onramp: ['`./install.sh --profile minimal --target cursor`'],
    verification_commands: [
      '`node tests/lib/install-targets.test.js`',
      '`npm run harness:audit -- --format json`',
    ],
    risk_notes: ['Cursor adapters must preserve existing project rules and avoid silent overwrite.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      '.cursor/',
      'scripts/lib/install-targets/cursor-project.js',
      'tests/lib/install-targets.test.js',
    ],
  },
  {
    id: 'gemini',
    harness: 'Gemini',
    state: 'Instruction-backed',
    supported_assets: [
      'Gemini project-local instructions',
      'shared skills',
      'rules',
      'compatibility docs',
    ],
    unsupported_surfaces: ['No full ECC hook parity; ecosystem ports must document drift from upstream ECC'],
    install_or_onramp: ['`./install.sh --profile minimal --target gemini`'],
    verification_commands: ['`node tests/lib/install-targets.test.js`'],
    risk_notes: ['Treat Gemini ports as ecosystem adapters until validated end to end inside Gemini CLI.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      '.gemini/',
      'scripts/lib/install-targets/gemini-project.js',
      'tests/lib/install-targets.test.js',
    ],
  },
  {
    id: 'zed',
    harness: 'Zed',
    state: 'Adapter-backed',
    supported_assets: [
      'Zed project settings',
      'flattened project rules',
      'shared skills',
      'commands',
      'agents',
    ],
    unsupported_surfaces: ['Zed external agents and native Agent Panel permissions are not Claude hooks'],
    install_or_onramp: ['`./install.sh --profile minimal --target zed`'],
    verification_commands: [
      '`node tests/lib/install-targets.test.js`',
      '`npm run harness:audit -- --format json`',
    ],
    risk_notes: ['Keep project settings conservative and do not copy BYOK/OpenRouter secrets into `.zed/`.'],
    last_verified_at: '2026-05-17',
    owner: 'ECC maintainers',
    source_docs: [
      '.zed/settings.json',
      'scripts/lib/install-targets/zed-project.js',
      'docs/architecture/cross-harness.md',
      'tests/lib/install-targets.test.js',
    ],
  },
  {
    id: 'dmux',
    harness: 'dmux',
    state: 'Adapter-backed',
    supported_assets: [
      'session snapshots',
      'tmux/worktree orchestration status',
      'handoff exports',
    ],
    unsupported_surfaces: ['dmux is an orchestration runtime, not an install target for skills/rules'],
    install_or_onramp: [
      '`node scripts/session-inspect.js --list-adapters`',
      'dmux session target inspection',
    ],
    verification_commands: ['`node tests/lib/session-adapters.test.js`'],
    risk_notes: ['Treat dmux events as session/runtime signals, not as a replacement for repo validation.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      'scripts/lib/session-adapters/dmux-tmux.js',
      'scripts/orchestration-status.js',
      'tests/lib/session-adapters.test.js',
    ],
  },
  {
    id: 'orca',
    harness: 'Orca',
    state: 'Reference-only',
    supported_assets: [
      'worktree lifecycle',
      'review state',
      'notification',
      'provider-identity design pressure',
    ],
    unsupported_surfaces: ['No ECC installer or direct adapter today'],
    install_or_onramp: ['Use as a comparison target for worktree/session state requirements'],
    verification_commands: ['`npm run observability:ready`'],
    risk_notes: ['Do not import product-specific assumptions; convert lessons into ECC event fields.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: ['docs/architecture/cross-harness.md'],
  },
  {
    id: 'superset',
    harness: 'Superset',
    state: 'Reference-only',
    supported_assets: [
      'workspace presets',
      'parallel-agent review loops',
      'worktree isolation design pressure',
    ],
    unsupported_surfaces: ['No ECC installer or direct adapter today'],
    install_or_onramp: ['Use as a comparison target for workspace preset taxonomy'],
    verification_commands: ['`npm run observability:ready`'],
    risk_notes: ['Keep ECC portable; do not require a desktop workspace to get basic value.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: ['docs/architecture/cross-harness.md'],
  },
  {
    id: 'ghast',
    harness: 'Ghast',
    state: 'Reference-only',
    supported_assets: [
      'terminal-native pane grouping',
      'cwd grouping',
      'search',
      'notifications',
    ],
    unsupported_surfaces: ['No ECC installer or direct adapter today'],
    install_or_onramp: ['Use as a comparison target for terminal-first session grouping'],
    verification_commands: ['`node scripts/session-inspect.js --list-adapters`'],
    risk_notes: ['Preserve terminal ergonomics before adding visual UI assumptions.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: ['docs/architecture/cross-harness.md'],
  },
  {
    id: 'terminal-only',
    harness: 'Terminal-only',
    state: 'Native',
    supported_assets: [
      'skills',
      'rules',
      'commands',
      'scripts',
      'harness audit',
      'observability readiness',
      'handoffs',
    ],
    unsupported_surfaces: ['No external UI, no automatic session control unless scripts are run explicitly'],
    install_or_onramp: [
      'Clone repo',
      'run commands directly',
      'use minimal profile for project installs',
    ],
    verification_commands: [
      '`npm run harness:audit -- --format json`',
      '`npm run observability:ready`',
    ],
    risk_notes: ['This is the fallback contract; every higher-level adapter should degrade to it.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      'scripts/harness-audit.js',
      'scripts/observability-readiness.js',
      'docs/architecture/observability-readiness.md',
    ],
  },
].map(freezeRecord));

function toTextList(value) {
  return Array.isArray(value) ? value.join('; ') : String(value || '');
}

function escapeMarkdownCell(value) {
  return toTextList(value).replace(/\|/g, '\\|').trim();
}

function renderMarkdownTable(records = ADAPTER_RECORDS) {
  const lines = [
    '| Harness or runtime | State | Supported assets | Unsupported or different surfaces | Install or onramp | Verification command | Risk notes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const record of records) {
    lines.push([
      record.harness,
      record.state,
      record.supported_assets,
      record.unsupported_surfaces,
      record.install_or_onramp,
      record.verification_commands,
      record.risk_notes,
    ].map(escapeMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  return lines.join('\n');
}

function renderStateTable() {
  const lines = [
    '| State | Meaning |',
    '| --- | --- |',
  ];

  for (const [state, meaning] of Object.entries(COMPLIANCE_STATES)) {
    lines.push(`| ${escapeMarkdownCell(state)} | ${escapeMarkdownCell(meaning)} |`);
  }

  return lines.join('\n');
}

function validateAdapterRecords(records = ADAPTER_RECORDS) {
  const errors = [];
  const ids = new Set();

  records.forEach((record, index) => {
    const label = record?.id || `record[${index}]`;

    for (const field of REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) {
        errors.push(`${label}: missing required field ${field}`);
      }
    }

    if (typeof record.id !== 'string' || !/^[a-z0-9-]+$/.test(record.id)) {
      errors.push(`${label}: id must be a lowercase slug`);
    } else if (ids.has(record.id)) {
      errors.push(`${label}: duplicate id`);
    } else {
      ids.add(record.id);
    }

    if (!Object.prototype.hasOwnProperty.call(COMPLIANCE_STATES, record.state)) {
      errors.push(`${label}: unknown state ${record.state}`);
    }

    for (const field of [
      'supported_assets',
      'unsupported_surfaces',
      'install_or_onramp',
      'verification_commands',
      'risk_notes',
      'source_docs',
    ]) {
      if (!Array.isArray(record[field]) || record[field].length === 0) {
        errors.push(`${label}: ${field} must be a non-empty array`);
        continue;
      }

      record[field].forEach((value, valueIndex) => {
        if (typeof value !== 'string' || !value.trim()) {
          errors.push(`${label}: ${field}[${valueIndex}] must be a non-empty string`);
        }
      });
    }

    if (typeof record.harness !== 'string' || !record.harness.trim()) {
      errors.push(`${label}: harness must be a non-empty string`);
    }

    if (typeof record.owner !== 'string' || !record.owner.trim()) {
      errors.push(`${label}: owner must be a non-empty string`);
    }

    if (typeof record.last_verified_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.last_verified_at)) {
      errors.push(`${label}: last_verified_at must be YYYY-MM-DD`);
    }
  });

  return errors;
}

function extractMatrixBlock(markdown) {
  const normalized = String(markdown).replace(/\r\n/g, '\n');
  const start = normalized.indexOf(MATRIX_BLOCK_START);
  const end = normalized.indexOf(MATRIX_BLOCK_END);

  if (start < 0 || end < 0 || end <= start) {
    return null;
  }

  return normalized.slice(start + MATRIX_BLOCK_START.length, end).trim();
}

function validateDocumentation(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..');
  const docPath = options.docPath || path.join(repoRoot, 'docs', 'architecture', 'harness-adapter-compliance.md');
  const errors = [];
  const source = fs.readFileSync(docPath, 'utf8');
  const actual = extractMatrixBlock(source);
  const expected = renderMarkdownTable();

  if (actual === null) {
    errors.push(`missing matrix block markers in ${path.relative(repoRoot, docPath)}`);
  } else if (actual !== expected) {
    errors.push(`matrix block in ${path.relative(repoRoot, docPath)} is not generated from adapter records`);
  }

  return errors;
}

module.exports = {
  ADAPTER_RECORDS,
  COMPLIANCE_STATES,
  MATRIX_BLOCK_END,
  MATRIX_BLOCK_START,
  REQUIRED_FIELDS,
  extractMatrixBlock,
  renderMarkdownTable,
  renderStateTable,
  validateAdapterRecords,
  validateDocumentation,
};
