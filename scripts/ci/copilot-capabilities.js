#!/usr/bin/env node
'use strict';

// An inventory and review queue, never a runtime permission or execution registry.
// Scan dispatcher declarations as text: importing them could load host runtimes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BASELINE = 'a64711b70660e6f53e6f4066762a5bf3a67f4485';
const UPSTREAM = 'b38be6a7f6350964d59328b52f0624e1d1d552d1';
const IGNORED = new Set(['__pycache__', '.pytest_cache', 'node_modules']);
const DISPATCHERS = ['scripts/hooks/bash-hook-dispatcher.js', 'scripts/hooks/posttooluse-dispatcher.js'];
const ACCESSORY_EVIDENCE = Object.freeze({
  'session-start:plan-canvas-sessions': ['fixture-projected', 'An opted-in project hook emits fixed context only for a verified session binding.', 'tests/lib/copilot-canvas.test.js'],
  'stop:plan-canvas-pending': ['fixture-projected', 'An opted-in project hook reports queue presence without consuming feedback or returning browser content.', 'tests/lib/copilot-canvas.test.js'],
  'stop:desktop-notify': ['fixture-projected', 'Opt-in fixed completion text through a bounded desktop provider.', 'tests/hooks/copilot-accessories.test.js'],
  'pre:edit-write:suggest-compact': ['fixture-projected', 'Opt-in stop suggestion based on verified tool-completion counts. No token estimate or automatic compaction.', 'tests/hooks/copilot-accessories.test.js'],
  'pre:compact': ['fixture-projected', 'Optional bounded lifecycle checkpoint at preCompact. Completion is separate.', 'tests/hooks/copilot-lifecycle.test.js'],
  'post:bash:build-complete': ['held-for-native-evidence', 'A correlated structured shell exit status is required to confirm a successful build.'],
  'post:bash:pr-created': ['held-for-native-evidence', 'A correlated structured creation receipt is required. Output URLs are insufficient.'],
  'post:bash:command-log-audit': ['limited', 'Opt-in metadata-only hook telemetry. Raw command logging is outside the Copilot privacy boundary.', 'tests/lib/copilot-telemetry.test.js'],
  'post:bash:command-log-cost': ['limited', 'Native session totals may be available. Per-command attribution is unavailable.', 'tests/hooks/copilot-policy-commands.test.js'],
  'pre:bash:auto-tmux-dev': ['limited', 'Dev-server guidance is advisory. No tmux process starts from the Copilot hook.', 'tests/hooks/copilot-guard.test.js'],
  'pre:bash:tmux-reminder': ['limited', 'Dev-server guidance is advisory. Native Windows tmux behavior is unavailable.', 'tests/hooks/copilot-guard.test.js'],
});

function walk(root, relative) {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .filter(entry => !IGNORED.has(entry.name))
    .flatMap(entry => {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) return walk(root, child);
      return entry.isFile() ? [child] : [];
    }).sort();
}
function read(root, source) { return fs.readFileSync(path.join(root, source)); }
function digest(root, source) { return crypto.createHash('sha256').update(read(root, source)).digest('hex'); }
function phaseFor(id) {
  if (/gateguard|bash:(?:block|auto|tmux|git|commit)/.test(id)) return 'P02';
  if (/format|console|quality|accumulator/.test(id)) return 'P03';
  if (/governance|metrics|context-monitor|skill:|activity/.test(id)) return 'P04';
  if (/observe/.test(id)) return 'P05';
  if (/evaluate-session/.test(id)) return 'P06';
  if (/mcp/.test(id)) return 'P07';
  if (/plan-canvas|desktop|compact|command-log|pr-created|build-complete/.test(id)) return 'P11';
  return 'P01';
}
function baseRow(root, id, kind, source, phase) {
  return {
    id, kind, source, source_sha256: digest(root, source), phase,
    status: 'review-required', required_event: null, required_tools: [],
    prerequisites: ['Copilot CLI version and platform must be recorded; semantic compatibility review required.'],
    differences: 'Presence in the canonical catalog does not establish installed or executable Copilot behavior.',
    automatic_tests: [], native: { status: 'native-unverified', evidence: [] },
    review: { status: 'pending', responsible_phase: phase, pull_request: null },
  };
}
function hookRows(root) {
  const source = 'hooks/hooks.metadata.json';
  const metadata = JSON.parse(read(root, source));
  const config = JSON.parse(read(root, 'hooks/hooks.json'));
  const declarations = Object.entries(metadata.entries).flatMap(([event, entries]) => entries.map((entry, index) => ({
    id: entry.id, event, source, description: entry.description,
    required_tools: [config.hooks[event]?.[index]?.matcher || 'host-defined'],
  })));
  const nested = DISPATCHERS.flatMap(dispatcher => {
    const text = read(root, dispatcher).toString('utf8');
    return [...text.matchAll(/\bid:\s*'((?:pre|post):[^']+)'/g)].map(match => ({
      id: match[1], event: match[1].startsWith('pre:') ? 'PreToolUse' : 'PostToolUse',
      source: dispatcher, description: 'Nested dispatcher policy; requires independent projection review.',
      required_tools: ['See canonical dispatcher matcher and Copilot tool mapping.'],
    }));
  });
  const ids = [...new Set([...declarations, ...nested].map(entry => entry.id))].sort();
  // This allowlist describes the pinned baseline only. Later implementation
  // updates must supply evidence rather than silently changing baseline status.
  const baselineHooks = new Set(['pre:bash:block-no-verify', 'pre:config-protection', 'pre:write:doc-file-warning', 'post:edit:console-warn']);
  return ids.map(id => {
    const occurrences = [...declarations, ...nested].filter(entry => entry.id === id);
    const entry = occurrences[0];
    const row = baseRow(root, `hook:${id}`, 'hook', entry.source, phaseFor(id));
    const accessory = ACCESSORY_EVIDENCE[id];
    return { ...row, canonical_id: id, description: entry.description,
      locations: occurrences.map(item => item.source), required_event: entry.event,
      required_tools: entry.required_tools,
      status: accessory?.[0] || (baselineHooks.has(id) ? 'baseline-projected' : 'adaptation-review-required'),
      differences: accessory?.[1] || (baselineHooks.has(id)
        ? 'Audited baseline projection exists; host delivery and native output remain unverified in this run.'
        : 'Canonical event/tool semantics require explicit Copilot adaptation or demonstrated host limitation.'),
      automatic_tests: accessory ? accessory.slice(2) : baselineHooks.has(id) ? ['tests/hooks/copilot-hook-adapter.test.js'] : [],
    };
  });
}
function kindFor(source) {
  if (/^skills\/[^/]+\/SKILL\.md$/.test(source)) return 'skill';
  if (/^agents\/[^/]+\.md$/.test(source)) return 'agent';
  if (/^commands\/[^/]+\.md$/.test(source)) return 'command';
  if (source.startsWith('rules/')) return 'rule';
  if (source.startsWith('scripts/')) return 'runtime';
  if (source.startsWith('mcp-configs/')) return 'mcp-config';
  return 'asset';
}
function mcpRows(root) {
  const source = 'mcp-configs/mcp-servers.json';
  const { mcpServers } = JSON.parse(read(root, source));
  return Object.keys(mcpServers).sort().map(name => {
    const server = mcpServers[name];
    return { ...baseRow(root, `mcp-server:${name}`, 'mcp-server', source, 'P07'),
      description: server.description || name,
      prerequisites: [
        ...(typeof server.command === 'string' ? [`Operator-selected executable: ${server.command}`] : ['Operator-selected remote MCP transport.']),
        ...Object.keys(server.env || {}).map(key => `Operator-configured environment variable: ${key}`),
        'Explicit selection, Copilot schema mapping and successful native handshake are required.',
      ],
      differences: name === 'github'
        ? 'Copilot CLI has a built-in GitHub integration; do not automatically install a duplicate.'
        : 'Catalog declaration only; no server is selected, installed, authenticated or executed by this inventory.',
    };
  });
}
function buildInventory(root) {
  const files = ['skills', 'agents', 'commands', 'rules', 'scripts', 'mcp-configs', 'hooks', 'assets']
    .flatMap(directory => walk(root, directory));
  const rows = files.map(source => {
    const kind = kindFor(source);
    const phase = kind === 'agent' ? 'P09' : kind === 'mcp-config' ? 'P07' : 'P10';
    const row = baseRow(root, `${kind}:${source}`, kind, source, phase);
    const signals = /\.(?:md|js|mjs|cjs|py|sh|ps1|json|yaml|yml|txt)$/.test(source)
      ? [...new Set([...read(root, source).toString('utf8').matchAll(/CLAUDE_[A-Z_]+|~\/\.claude|\b(?:scripts|skills|assets)\/[a-zA-Z0-9_./-]+/g)].map(match => match[0]))].sort()
      : [];
    return { ...row, dependency_signals: signals,
      differences: kind === 'agent'
        ? 'Baseline projection drops tools/model metadata; restriction preservation requires P09 review.'
        : row.differences };
  });
  return {
    schema_version: 1,
    baseline: { repository: 'manuel-albanesee/ECC', branch: 'feat/copilot-memory-commands',
      sha: BASELINE, upstream_sha: UPSTREAM, date: '2026-11-03', mode: 'project-installer' },
    scope: 'All regular files under skills, agents, commands, rules, scripts, mcp-configs, hooks and assets; metadata and nested dispatcher policies are additional semantic rows. Symlinks are not followed.',
    evidence_policy: 'Generated source coverage and dependency signals require semantic review. No native or external-integration certification is inferred.',
    capabilities: [...hookRows(root), ...mcpRows(root), ...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  };
}
function renderReport(inventory) {
  const counts = inventory.capabilities.reduce((result, item) => ({ ...result, [item.kind]: (result[item.kind] || 0) + 1 }), {});
  const hooks = inventory.capabilities.filter(item => item.kind === 'hook');
  return `# Copilot parity inventory\n\nGenerated by \`node scripts/ci/copilot-capabilities.js --write\`. Check freshness with \`--check\`.\n\n` +
    `P00 baseline: \`${inventory.baseline.sha}\`; upstream reference: \`${inventory.baseline.upstream_sha}\`. These pinned references are historical; source hashes describe the working tree at generation.\n\n` +
    `This inventory is a review queue, not a runtime registry or a compatibility certificate. Each row records source/hash, owner phase, event/tool needs, prerequisites, differences, automatic-test pointers and native evidence. All rows remain **native-unverified** until a versioned native run supplies evidence. Dependency signals include documentation examples and need semantic review; absence of a signal does not establish portability.\n\n` +
    `## Coverage\n\n| Kind | Rows |\n| --- | ---: |\n${Object.entries(counts).sort().map(([kind, count]) => `| ${kind} | ${count} |`).join('\n')}\n\n` +
    `Every regular file in the declared scope is retained, including runtime helpers and nested skill assets. Nested Bash and PostToolUse dispatcher policies have separate IDs. No difficult capability is removed from the denominator. Symlinks are excluded without dereferencing them.\n\n` +
    `## Hook destinations\n\n| Canonical ID | Event | Projection status | Owner phase |\n| --- | --- | --- | --- |\n${hooks.map(item => `| ${item.canonical_id} | ${item.required_event} | ${item.status} | ${item.phase} |`).join('\n')}\n\n` +
    `## Evidence and gates\n\nThe pinned source provides four audited pre/post-tool projections plus lifecycle and Hookify runtimes. Synthetic fixtures test parsing and subprocess behavior; they do not prove host event delivery, PowerShell coverage, agent restrictions, authenticated integrations or OS parity. Native evidence must identify SHA, CLI version, OS, installation mode, case ID, redacted payload and result.\n\n` +
    `P00 remains partial until the Windows discovery, deny, post-tool and checkpoint/resume cases run. P01 owns contract and gate budgets; P02–P11 implement/review the recorded destinations; P12 owns M1 native certification; P13 adds plugin certification; P14 owns M2 release checks. No implementation or certification is inferred from an entry point count.\n\n` +
    `Use the machine-readable [inventory](../manifests/copilot-capabilities.json) for individual rows. Baseline execution results and environment evidence belong in a separate run record; regeneration never fabricates test results.\n`;
}
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--write', '--check'].includes(args[0])) {
    throw new Error('Usage: node scripts/ci/copilot-capabilities.js --write|--check');
  }
  const root = path.resolve(__dirname, '../..');
  const inventory = buildInventory(root);
  const outputs = [
    ['manifests/copilot-capabilities.json', `${JSON.stringify(inventory, null, 2)}\n`],
    ['docs/COPILOT-PARITY.md', renderReport(inventory)],
  ];
  for (const [relative, content] of outputs) {
    const target = path.join(root, relative);
    if (args[0] === '--write') fs.writeFileSync(target, content);
    else if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) throw new Error(`${relative} is stale; regenerate with --write`);
  }
  console.log(`Copilot inventory: ${inventory.capabilities.length} rows (${args[0].slice(2)}). Native evidence remains unverified.`);
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildInventory, renderReport };
