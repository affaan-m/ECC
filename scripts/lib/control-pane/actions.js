'use strict';

const path = require('path');

const ACTION_DEFINITIONS = new Map([
  [
    'sync-knowledge',
    {
      label: 'Sync Knowledge',
      description: 'Import all configured ECC2 memory connectors into the context graph.',
      args: ({ limit }) => [
        'run',
        '--quiet',
        '--',
        'graph',
        'connector-sync',
        '--all',
        '--json',
        '--limit',
        String(limit),
      ],
      executable: true,
    },
  ],
  [
    'recall-knowledge',
    {
      label: 'Recall Knowledge',
      description: 'Run ECC2 context recall for the current operator query.',
      args: ({ query, limit }) => [
        'run',
        '--quiet',
        '--',
        'graph',
        'recall',
        query || 'ECC control pane',
        '--json',
        '--limit',
        String(limit),
      ],
      executable: true,
    },
  ],
  [
    'graph-sync',
    {
      label: 'Backfill Graph',
      description: 'Backfill the ECC2 graph from sessions, decisions, file activity, and messages.',
      args: ({ limit }) => [
        'run',
        '--quiet',
        '--',
        'graph',
        'sync',
        '--all',
        '--json',
        '--limit',
        String(limit),
      ],
      executable: true,
    },
  ],
  [
    'open-dashboard',
    {
      label: 'Open TUI',
      description: 'Launch the ECC2 terminal dashboard.',
      args: () => ['run', '--quiet', '--', 'dashboard'],
      executable: false,
    },
  ],
]);

function normalizeLimit(value, fallback = 25) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 500);
}

function shellQuote(value) {
  const text = String(value);
  if (text.length === 0) return "''";
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function commandLineFor(action) {
  return [
    `cd ${shellQuote(action.cwd)}`,
    '&&',
    shellQuote(action.command),
    ...action.args.map(shellQuote),
  ].join(' ');
}

function buildControlPaneAction(actionId, options = {}) {
  const definition = ACTION_DEFINITIONS.get(actionId);
  if (!definition) {
    throw new Error(`Unknown control-pane action: ${actionId}`);
  }

  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const cwd = path.join(repoRoot, 'ecc2');
  const limit = normalizeLimit(options.limit);
  const query = String(options.query || '').trim();
  const args = definition.args({ limit, query });
  const action = {
    id: actionId,
    label: definition.label,
    description: definition.description,
    command: 'cargo',
    args,
    cwd,
    executable: definition.executable,
  };

  return {
    ...action,
    commandLine: commandLineFor(action),
  };
}

function buildControlPaneActions(options = {}) {
  return Array.from(ACTION_DEFINITIONS.keys()).map(actionId =>
    buildControlPaneAction(actionId, options)
  );
}

module.exports = {
  buildControlPaneAction,
  buildControlPaneActions,
  shellQuote,
};
