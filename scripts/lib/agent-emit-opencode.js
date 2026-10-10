#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — OpenCode emitter.
 *
 * Verified against OpenCode v2.0.25 and opencode.ai/docs/agents:
 *   - Agents are markdown files in `.opencode/agents/` (project) or
 *     `~/.config/opencode/agents/` (global); the FILENAME is the agent name,
 *     so no `name:` frontmatter field is emitted.
 *   - Frontmatter uses `description`, `mode` (`subagent`), and `permission`
 *     (a mapping of permission keys -> "allow" | "ask" | "deny").
 *   - Agent permissions MERGE with global config (agent rules take precedence),
 *     and OpenCode's global default is `*: allow`. So the emitter writes a
 *     DENY BASELINE: `"*": deny` first, then `allow` only for source-authorized
 *     keys. This prevents MCP servers, subagent delegation, todos, and other
 *     built-ins from being inherited from global configuration.
 *
 * Claude -> OpenCode permission keys:
 *   Read -> read, Grep -> grep, Glob -> glob, Bash -> bash,
 *   Edit/Write -> edit (OpenCode's `edit` key gates write/edit/apply_patch),
 *   WebFetch -> webfetch, WebSearch -> websearch.
 */

const CLAUDE_TO_OPENCODE_PERMISSION = Object.freeze({
  Read: 'read',
  Grep: 'grep',
  Glob: 'glob',
  Bash: 'bash',
  Edit: 'edit',
  Write: 'edit', // `edit` gates write, edit, and apply_patch
  WebFetch: 'webfetch',
  WebSearch: 'websearch',
});

const GRANTABLE_KEYS = ['read', 'grep', 'glob', 'bash', 'edit', 'webfetch', 'websearch'];

function yamlScalar(value) {
  const s = String(value);
  if (/^\s|\s$|: |\n|\s#|^[-?*&|>#@`"'\][{}!,]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/** Emit an OpenCode agent definition for one IR object. */
function emitOpenCodeAgent(ir) {
  const warnings = [];
  const granted = new Set();

  for (const sourceTool of ir.tools) {
    const perm = CLAUDE_TO_OPENCODE_PERMISSION[sourceTool];
    if (perm) {
      granted.add(perm);
    } else if (sourceTool.startsWith('mcp__')) {
      warnings.push(`${ir.id}: MCP tool ${sourceTool} not mapped (denied by the deny baseline; configure explicitly if needed)`);
    } else {
      warnings.push(`${ir.id}: unmapped tool: ${sourceTool} (no OpenCode permission key)`);
    }
  }

  const permissionLines = ['  "*": deny'];
  for (const key of GRANTABLE_KEYS) {
    if (granted.has(key)) {
      permissionLines.push(`  ${key}: allow`);
    }
  }

  const frontmatter = [
    '---',
    ...(ir.model ? [`# source model tier: ${ir.model}`] : []),
    `description: ${yamlScalar(ir.description)}`,
    'mode: subagent',
    'permission:',
    ...permissionLines,
    '---',
  ];

  const body = (ir.body || '').replace(/^\n+/, '').trimEnd();
  const markdown = frontmatter.join('\n') + '\n\n' + body + '\n';
  return { markdown, warnings, tools: [...granted] };
}

/** Emit the full set of OpenCode agents, sorted by id for determinism. */
function emitAllOpenCodeAgents(irs) {
  const results = [];
  const warnings = [];
  let modelTiers = {};
  let unsupported = 0;

  for (const ir of [...irs].sort((a, b) => a.id.localeCompare(b.id))) {
    const { markdown, warnings: w, tools } = emitOpenCodeAgent(ir);
    results.push({ id: ir.id, name: ir.id, tools, markdown });
    warnings.push(...w);

    if (ir.model) {
      modelTiers = { ...modelTiers, [ir.model]: (modelTiers[ir.model] || 0) + 1 };
    }
    unsupported += ir.tools.filter(t => !CLAUDE_TO_OPENCODE_PERMISSION[t]).length;
  }

  const notes = [];
  if (Object.keys(modelTiers).length) {
    const tiers = Object.entries(modelTiers).map(([t, n]) => `${t} x${n}`).join(', ');
    notes.push(`model tiers preserved as comments (${tiers}) — OpenCode selects its own model`);
  }
  if (unsupported) {
    notes.push(`unmapped tools: ${unsupported} (WebSearch/mcp__* — denied by the deny baseline)`);
  }

  return { results, warnings, notes };
}

module.exports = {
  CLAUDE_TO_OPENCODE_PERMISSION,
  emitOpenCodeAgent,
  emitAllOpenCodeAgents,
  yamlScalar,
};
