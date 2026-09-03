#!/usr/bin/env node
/**
 * Generate Codex agent role files from the canonical Claude agent definitions.
 *
 * Codex loads subagents from agent role files that must define a non-empty
 * `name`, a `description`, and `developer_instructions`; `model`,
 * `model_reasoning_effort`, and `sandbox_mode` are optional. Codex rejects a
 * role file missing any required field with "Ignoring malformed agent role
 * definition", so all three are emitted for every agent. The canonical agents in `agents/*.md` use
 * Claude's markdown-plus-frontmatter format, which Codex cannot parse, so the
 * Codex-facing surface under `.codex/agents/` is generated from them the same
 * way `.agents/skills/` mirrors `skills/`.
 *
 * Hand-authored role files (for example `.codex/agents/reviewer.toml`) are left
 * untouched: only files carrying the generated-surface marker are rewritten.
 *
 * Usage:
 *   node scripts/codex/generate-agent-roles.js --check
 *   node scripts/codex/generate-agent-roles.js --write
 *   node scripts/codex/generate-agent-roles.js --check --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const ROLES_DIR = path.join(REPO_ROOT, '.codex', 'agents');
const GENERATED_MARKER = '# generated-by: scripts/codex/generate-agent-roles.js';

// Reviewers and planners benefit from deeper reasoning; everything else stays
// on the Codex default tier so role files do not pin cost unnecessarily.
const HIGH_EFFORT_SUFFIXES = ['-reviewer', '-architect'];
const HIGH_EFFORT_NAMES = new Set(['architect', 'planner', 'code-reviewer', 'security-reviewer']);

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/codex/generate-agent-roles.js [--check|--write] [--json]

Generate the Codex-facing agent role files under .codex/agents/ from agents/*.md.

  --check   Report drift without writing (default)
  --write   Write the generated role files
  --json    Emit machine-readable output
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const parsed = { write: false, json: false, help: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--write') parsed.write = true;
    else if (arg === '--check') parsed.write = false;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      showHelp(1);
    }
  }
  return parsed;
}

function listAgentNames() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name.slice(0, -3))
    .sort();
}

function parseAgent(name) {
  const source = fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const description = readScalar(frontmatter, 'description');
  const tools = readScalar(frontmatter, 'tools');
  return { description, tools, body: body.trim() };
}

// Reads a top-level scalar, including YAML block scalars and folded
// continuation lines, and collapses it to a single line.
function readScalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*(?:\\r?\\n[ \\t]+.*)*)`, 'm'));
  if (!match) return '';
  return match[1].replace(/^[>|][-+]?\s*/, '').replace(/\s+/g, ' ').trim();
}

function sandboxModeFor(tools) {
  return /\b(Write|Edit|MultiEdit|NotebookEdit)\b/.test(tools) ? 'workspace-write' : 'read-only';
}

function reasoningEffortFor(name) {
  if (HIGH_EFFORT_NAMES.has(name)) return 'high';
  return HIGH_EFFORT_SUFFIXES.some(suffix => name.endsWith(suffix)) ? 'high' : 'medium';
}

// TOML basic strings honor backslash escapes, so quotes, backslashes, and
// control characters must be escaped.
function escapeBasic(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// TOML basic multi-line strings honor backslash escapes, so a literal
// backslash and any embedded delimiter must be escaped.
function escapeMultiline(value) {
  return value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
}

function renderRole(name, agent) {
  return [
    GENERATED_MARKER,
    `# source: agents/${name}.md`,
    `name = "${name}"`,
    `description = "${escapeBasic(agent.description)}"`,
    `model_reasoning_effort = "${reasoningEffortFor(name)}"`,
    `sandbox_mode = "${sandboxModeFor(agent.tools)}"`,
    '',
    'developer_instructions = """',
    escapeMultiline(agent.body),
    '"""',
    '',
  ].join('\n');
}

function isGenerated(filePath) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, 'utf8').startsWith(GENERATED_MARKER);
}

function run() {
  const args = parseArgs(process.argv);
  if (args.help) showHelp();

  const expected = new Map();
  const skipped = [];

  for (const name of listAgentNames()) {
    const agent = parseAgent(name);
    if (!agent || !agent.body || !agent.description) {
      skipped.push(name);
      continue;
    }
    expected.set(name, renderRole(name, agent));
  }

  fs.mkdirSync(ROLES_DIR, { recursive: true });

  const existingGenerated = fs.readdirSync(ROLES_DIR)
    .filter(file => file.endsWith('.toml'))
    .filter(file => isGenerated(path.join(ROLES_DIR, file)))
    .map(file => file.slice(0, -5))
    .sort();

  const drifted = [];
  const created = [];
  const removed = existingGenerated.filter(name => !expected.has(name));

  for (const [name, contents] of expected) {
    const target = path.join(ROLES_DIR, `${name}.toml`);
    if (!fs.existsSync(target)) {
      created.push(name);
    } else if (!isGenerated(target)) {
      // A hand-authored role file owns this name; never overwrite it.
      continue;
    } else if (fs.readFileSync(target, 'utf8') !== contents) {
      drifted.push(name);
    }
  }

  if (args.write) {
    for (const [name, contents] of expected) {
      const target = path.join(ROLES_DIR, `${name}.toml`);
      if (fs.existsSync(target) && !isGenerated(target)) continue;
      fs.writeFileSync(target, contents);
    }
    for (const name of removed) {
      fs.unlinkSync(path.join(ROLES_DIR, `${name}.toml`));
    }
  }

  const result = {
    generated: expected.size,
    created: created.length,
    drifted: drifted.length,
    removed: removed.length,
    skipped,
    mode: args.write ? 'write' : 'check',
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (args.write) {
    console.log(`Codex agent roles written: ${expected.size} (created ${created.length}, updated ${drifted.length}, removed ${removed.length})`);
    if (skipped.length) console.log(`Skipped (no frontmatter or empty body): ${skipped.join(', ')}`);
  } else {
    const stale = created.length + drifted.length + removed.length;
    if (stale === 0) {
      console.log(`Codex agent roles are up to date (${expected.size} role files).`);
    } else {
      console.log('Codex agent role files are out of date.');
      if (created.length) console.log(`  Missing: ${created.join(', ')}`);
      if (drifted.length) console.log(`  Stale: ${drifted.join(', ')}`);
      if (removed.length) console.log(`  Orphaned: ${removed.join(', ')}`);
      console.log('\nRun: npm run codex:agent-roles:write');
    }
  }

  const stale = created.length + drifted.length + removed.length;
  process.exit(!args.write && stale > 0 ? 1 : 0);
}

run();
