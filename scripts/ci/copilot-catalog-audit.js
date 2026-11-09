#!/usr/bin/env node
'use strict';

// Static evidence only: no catalog file is imported or executed, and no prose
// finding can become a permission, auto-fix or compatibility certification.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getCommandCapability } = require('../lib/install/copilot-command-capabilities');
const {
  copilotRuntimeSkillStatus, runtimeSkillPaths,
} = require('../lib/install/copilot-runtime-skills');
const { adaptCopilotRuntimeSkill } = require('../lib/install/copilot-runtime-skill-transform');
const ROOTS = ['skills', 'agents', 'commands', 'rules', 'scripts', 'hooks', 'assets', 'mcp-configs'];
const SKIP = new Set(['node_modules', '__pycache__', '.pytest_cache']);
const PATTERNS = [
  ['host-variable', /\bCLAUDE_[A-Z_]+\b/g],
  ['host-path', /~\/\.claude|\$\{?CLAUDE_PLUGIN_ROOT\}?|\.claude\/(?:commands|agents|skills|hooks)/g],
  ['host-api', /\b(?:Task|Skill)\s*\(/g],
  ['interpreter', /\b(?:python3?|bash|powershell|pwsh|node|npx|uvx)\b/g],
  ['external-tool', /\b(?:gh|claude|copilot|pm2|tmux|docker|ollama|codex)\b/g],
  ['renamed-command', /\/(?:plan|pr|sessions)(?![a-zA-Z0-9_-])/g],
  ['local-reference', /(?:\$\{?CLAUDE_PLUGIN_ROOT\}?\/)?(?:scripts|skills|assets|agents|commands|hooks|rules|mcp-configs)\/[a-zA-Z0-9_./${}-]+/g],
];

function walk(root, relative) {
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => !SKIP.has(entry.name)).flatMap(entry => {
    const child = `${relative}/${entry.name}`;
    return entry.isDirectory() ? walk(root, child) : entry.isFile() ? [child] : [];
  }).sort();
}

function kindFor(source) {
  if (/^skills\/[^/]+\/SKILL\.md$/.test(source)) return 'skill';
  if (/^agents\/[^/]+\.md$/.test(source)) return 'agent';
  if (/^commands\/[^/]+\.md$/.test(source)) return 'command';
  if (source.startsWith('rules/')) return 'rule';
  return /^(?:scripts|hooks)\//.test(source) ? 'runtime' : 'asset';
}

function referenceResolution(root, source, kind, reference) {
  if (kind === 'local-reference') {
    if (reference.includes('$')) return 'dynamic';
    const resolved = path.resolve(root, reference);
    if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) return 'outside-source-root';
    if (fs.existsSync(resolved)) return 'present';
    const skill = source.match(/^skills\/[^/]+\//)?.[0];
    if (skill) {
      const skillRoot = path.resolve(root, skill);
      const local = path.resolve(skillRoot, reference);
      if (local.startsWith(skillRoot + path.sep) && fs.existsSync(local)) return 'skill-local-present';
    }
    return 'missing';
  }
  if (kind === 'interpreter' || kind === 'external-tool') return 'external-prerequisite-unverified';
  return 'host-specific-review';
}

function scanText(root, source, text) {
  const markdown = source.endsWith('.md');
  let fenced = false;
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; return []; }
    const context = markdown && !fenced ? 'documentation-reference' : 'executable-candidate';
    return PATTERNS.flatMap(([kind, pattern]) => [...line.matchAll(new RegExp(pattern.source, pattern.flags))].map(match => ({
      kind, line: index + 1, column: match.index + 1, reference: match[0].replace(/[.]+$/, ''),
      context, resolution: referenceResolution(root, source, kind, match[0].replace(/[.]+$/, '')),
      review: 'semantic-review-required',
    })));
  });
}

function buildAudit(root) {
  const sources = ROOTS.flatMap(directory => walk(root, directory)).sort();
  const sourcePaths = new Set(sources);
  const files = sources.map(source => {
    const data = fs.readFileSync(path.join(root, source));
    const findings = /\.(?:md|js|cjs|mjs|ts|tsx|py|sh|ps1|cmd|json|yaml|yml|txt|toml)$/.test(source)
      ? scanText(root, source, data.toString('utf8')) : [];
    const host = findings.some(finding => /^(?:host-|renamed-command)/.test(finding.kind));
    const missing = findings.some(finding => finding.kind === 'local-reference' && !['present', 'skill-local-present'].includes(finding.resolution));
    const projection = copilotRuntimeSkillStatus(source);
    const body = projection ? adaptCopilotRuntimeSkill(data.toString('utf8'), source) : '';
    const closure = new Set(projection ? runtimeSkillPaths([source]) : []);
    const references = [...new Set([...body.matchAll(/\.github\/ecc\/(scripts\/[\w./-]+\.(?:[cm]?js|py|ps1|sh))\b/g)]
      .map(match => match[1]))].sort().map(runtime => ({
      path: runtime,
      resolution: !sourcePaths.has(runtime) ? 'missing'
        : closure.has(runtime) ? 'standalone-closure' : 'additional-module',
    }));
    return { id: `catalog:${source}`, source, kind: kindFor(source),
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      classification: host || missing ? 'adaptation-review-required'
        : findings.length ? 'external-or-portability-review-required' : 'portability-review-required',
      ...(projection ? { copilot_projection: projection, copilot_runtime_references: references } : {}), native_status: 'native-unverified', findings };
  });
  const unknown = files.filter(file => file.kind === 'command').map(file => path.basename(file.source, '.md'))
    .filter(name => !fs.existsSync(path.join(root, 'skills', name, 'SKILL.md')) && getCommandCapability(name).status === 'blocked');
  return { schema_version: 1, snapshot: 'a64711b70660e6f53e6f4066762a5bf3a67f4485',
    scope: ROOTS, policy: 'Static source coverage only; every finding and every provisional classification needs semantic review. Documentation references are not proved harmless, executable candidates are not proved executable. No source is rewritten.',
    unknown_commands: unknown,
    missing_projection_runtimes: files.flatMap(row => (row.copilot_runtime_references || [])
      .filter(reference => reference.resolution === 'missing')
      .map(reference => ({ source: row.source, path: reference.path }))),
    files };
}

function renderReport(audit) {
  const counts = audit.files.reduce((all, row) => ({ ...all, [row.kind]: (all[row.kind] || 0) + 1 }), {});
  const projections = audit.files.filter(row => row.copilot_projection);
  const findings = audit.files.flatMap(file => file.findings.map(finding => ({ source: file.source, ...finding })));
  const grouped = findings.reduce((all, row) => ({ ...all, [row.kind]: (all[row.kind] || 0) + 1 }), {});
  return '# Copilot catalog dependency audit\n\n' +
    'Regenerate with `node scripts/ci/copilot-catalog-audit.js --write`; enforce freshness and command registration with `--check`.\n\n' +
    'This scanner covers the declared canonical source directories. Canonical findings remain a review index. The full-profile package gate checks rendered Copilot instructions separately. Native invocation and external-provider evidence remain **native-unverified** here.\n\n' +
    '| File family | Files |\n| --- | ---: |\n' + Object.entries(counts).sort().map(([kind, count]) => `| ${kind} | ${count} |`).join('\n') + '\n\n' +
    '| Finding family | Occurrences |\n| --- | ---: |\n' + Object.entries(grouped).sort().map(([kind, count]) => `| ${kind} | ${count} |`).join('\n') + '\n\n' +
    '## Interpretation\n\nProse is labelled `documentation-reference`; fenced Markdown and code are labelled `executable-candidate`. Both labels are heuristic and require semantic review. Examples and historical references may resemble dependencies. Conversely, interpolated, constructed, relative or external paths may evade these patterns; zero findings does not establish portability. `present` identifies a checkout-root path. `skill-local-present` identifies a possible resolution under the canonical skill directory. Both are path existence checks. Actual commands still need an explicit working-directory or path convention.\n\n' +
    'Every row has a stable path ID and source hash. The JSON records each finding with line, column, type, resolution and review state. It covers canonical skill documents plus their nested assets, all agents, commands, rules, scripts, hook helpers and declared assets. Symlinks are not followed.\n\n' +
    '## Explicit skill adaptations\n\nThe installer owns this exact-path mapping. Notice-only entries describe an unsupported canonical workflow and any available alternative. Canonical findings remain visible for both groups.\n\n' +
    'Literal managed runtime references in projected instructions are checked separately. A standalone closure entry is planned by the skill itself. An additional module entry requires a separately installed helper. These are source and plan checks; test actual runtime execution in an installed project.\n\n' +
    '| Skill | Copilot projection | Managed runtime references |\n| --- | --- | --- |\n' +
    projections.map(row => `| \`${row.source}\` | ${row.copilot_projection} | ${row.copilot_runtime_references
      .map(reference => `\`${reference.path}\` (${reference.resolution})`).join(', ') || '—'} |`).join('\n') + '\n\n' +
    '## Installed profile and native evidence\n\nRun `npm run copilot:verify-package` to compare the installed full profile with the source plan and check rendered instructions, literal managed helper paths and bundled skill assets. The gate records reviewed project examples explicitly. Unknown command names must receive an explicit audited registry entry or a canonical skill projection; `--check` rejects them even when the generated snapshot is fresh.\n\n' +
    `Unknown command entries: ${audit.unknown_commands.length}. Missing projected managed runtime files: ${audit.missing_projection_runtimes.length}.\n\n` +
    'The installer continues using its existing explicit command capability registry. This audit is an additional CI diagnostic, not a second runtime permission registry. Use NATIVE-018 and NATIVE-019 for native invocation and external-prerequisite evidence.\n';
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--write', '--check'].includes(args[0])) throw new Error('Usage: copilot-catalog-audit.js --write|--check');
  const root = path.resolve(__dirname, '../..');
  const audit = buildAudit(root);
  const outputs = { 'manifests/copilot-catalog-audit.json': `${JSON.stringify(audit, null, 2)}\n`,
    'docs/COPILOT-CATALOG-AUDIT.md': renderReport(audit) };
  for (const [file, text] of Object.entries(outputs)) {
    if (args[0] === '--write') fs.writeFileSync(path.join(root, file), text);
    else if (fs.readFileSync(path.join(root, file), 'utf8') !== text) throw new Error(`Stale catalog audit: ${file}`);
  }
  if (audit.unknown_commands.length) throw new Error(`Unregistered Copilot commands: ${audit.unknown_commands.join(', ')}`);
  if (audit.missing_projection_runtimes.length) {
    throw new Error(`Missing Copilot projection runtimes: ${audit.missing_projection_runtimes
      .map(({ source, path: runtime }) => `${source} -> ${runtime}`).join(', ')}`);
  }
  console.log(`Copilot catalog audit: ${audit.files.length} files; semantic/native review remains required.`);
}

module.exports = { buildAudit, scanText, renderReport };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
