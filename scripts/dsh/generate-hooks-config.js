#!/usr/bin/env node
/**
 * Generate a DeepSeek Harness (DSH) hooks config from hooks/hooks.json.
 *
 * DSH bridges ECC command hooks through the first-party plugin
 * @deepseek-ai/dsh-hooks-claude-code. The bridge supports a subset of
 * Claude Code hook events and lower-cases tool names in matchers, so this
 * script converts the canonical ECC hooks.json into a DSH-compatible file.
 *
 * Usage:
 *   node scripts/dsh/generate-hooks-config.js [--ecc-root <dir>] [--out <file>]
 *
 * Defaults:
 *   --ecc-root  directory of this checkout (repo root)
 *   --out       <ecc-root>/hooks/hooks.dsh.json
 *
 * The output is a Claude Code hooks-format file consumed by the bridge:
 *   { "hooks": { "PreToolUse": [ { "matcher": "...", "hooks": [...] } ] } }
 *
 * Unsupported ECC events (no DSH bridge counterpart) are skipped and
 * reported on stderr: PreCompact, PostToolUseFailure, SessionEnd.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED_EVENTS = new Set([
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop',
  'SubagentStart', 'SubagentStop',
]);

// Claude Code tool names -> DSH lower-case tool names used by the bridge.
const TOOL_NAME_MAP = {
  Bash: 'bash',
  PowerShell: 'powershell',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  Skill: 'skill',
  Task: 'task',
};

function parseArgs(argv) {
  const opts = { eccRoot: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ecc-root' || a === '--out') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        process.stderr.write('Missing value for ' + a + '\n');
        process.exit(2);
      }
      if (a === '--ecc-root') opts.eccRoot = value;
      else opts.out = value;
    }
    else {
      process.stderr.write('Unknown argument: ' + a + '\n');
      process.exit(2);
    }
  }
  return opts;
}

/**
 * Map a Claude Code matcher expression to DSH tool-name tokens.
 * Split on |, map known tool names to lower-case DSH names, keep regex
 * passthrough tokens (like .* or ^mcp__) untouched, de-duplicate.
 */
function mapMatcher(matcher) {
  if (typeof matcher !== 'string' || matcher.length === 0) return matcher;
  const parts = matcher.split('|').map(function (t) {
    const v = t.trim();
    if (v === '' || /^\^?mcp__/.test(v) || /[\\^$.*+?()[\]{}]/.test(v)) return v;
    const mapped = TOOL_NAME_MAP[v];
    return mapped !== undefined ? mapped : v.toLowerCase();
  });
  return Array.from(new Set(parts)).join('|');
}

/**
 * Rewrite an ECC command into a DSH bridge command.
 *
 * The bridge runs commands with bash -c but does not export the plugin
 * root as an environment variable for every hook process. Each ECC hook
 * command embeds a resolver (`node -e "..." <hook-id> <script> [args]`)
 * that resolves scripts/hooks/plugin-hook-bootstrap.js from the
 * CLAUDE_PLUGIN_ROOT environment variable, so prefixing the variables
 * inline (env-prefix form) is the only required change.
 */
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function mapCommand(command, eccRoot) {
  const prefix = 'CLAUDE_PLUGIN_ROOT=' + shellQuote(eccRoot) +
    ' ECC_PLUGIN_ROOT=' + shellQuote(eccRoot) + ' ';
  return prefix + command;
}

/**
 * Convert the ECC hooks document into the DSH bridge format.
 * Returns { config, report } where report lists skipped events/entries.
 */
function generateConfig(eccRoot, sourceDoc) {
  const out = { hooks: {} };
  const report = [];
  for (const entry of Object.entries(sourceDoc.hooks || {})) {
    const event = entry[0];
    const groups = entry[1];
    if (!SUPPORTED_EVENTS.has(event)) {
      report.push('skip event ' + event + ' (not bridged by DSH)');
      continue;
    }
    const outGroups = [];
    for (const group of groups) {
      const hooks = [];
      for (const h of group.hooks || []) {
        if (h.type !== 'command' || typeof h.command !== 'string') {
          report.push('skip non-command hook on ' + event);
          continue;
        }
        const mapped = { type: 'command', command: mapCommand(h.command, eccRoot) };
        if (typeof h.timeout === 'number') mapped.timeout = h.timeout;
        hooks.push(mapped);
        report.push('ok ' + event);
      }
      if (hooks.length) {
        outGroups.push({ matcher: mapMatcher(group.matcher), hooks: hooks });
      }
    }
    if (outGroups.length) out.hooks[event] = outGroups;
  }
  return { config: out, report: report };
}

function main() {
  const opts = parseArgs(process.argv);
  const eccRoot = path.resolve(opts.eccRoot || path.join(__dirname, '..', '..'));
  const sourcePath = path.join(eccRoot, 'hooks', 'hooks.json');
  if (!fs.existsSync(sourcePath)) {
    process.stderr.write('ECC hooks.json not found at ' + sourcePath + '\n');
    process.exit(1);
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  } catch (err) {
    process.stderr.write('Failed to parse ' + sourcePath + ': ' + err.message + '\n');
    process.exit(1);
  }
  const result = generateConfig(eccRoot, doc);
  const outPath = opts.out || path.join(eccRoot, 'hooks', 'hooks.dsh.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result.config, null, 2) + '\n');
  const okCount = result.report.filter(function (r) { return r.indexOf('ok ') === 0; }).length;
  const notes = result.report.filter(function (r) { return r.indexOf('ok ') !== 0; });
  process.stderr.write('wrote ' + outPath + '\n');
  process.stderr.write('hook commands: ' + okCount + '\n');
  if (notes.length) process.stderr.write(notes.join('; ') + '\n');
}

module.exports = { generateConfig, mapMatcher, mapCommand, shellQuote, SUPPORTED_EVENTS, TOOL_NAME_MAP };

if (require.main === module) main();
