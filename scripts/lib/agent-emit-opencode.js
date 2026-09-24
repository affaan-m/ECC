#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — OpenCode emitter.
 *
 * Turns IR objects into OpenCode agent definitions. OpenCode agents live under
 * `.opencode/agent/*.md` and use frontmatter `name`, `description`, `mode`
 * (`subagent` for delegated agents), and `tools` — a *mapping* from tool names
 * to booleans, not a scalar. The prompt lives in the document body.
 *
 * The emitted `tools` mapping is explicit about mutating tools: `bash`, `edit`,
 * and `write` are set to `false` unless the source allowlist granted them, so a
 * read-only Claude agent never gains write or terminal access in OpenCode.
 */

const CLAUDE_TO_OPENCODE_TOOLS = Object.freeze({
  Read: 'read',
  Grep: 'grep',
  Glob: 'glob',
  Bash: 'bash',
  Edit: 'edit',
  Write: 'write',
  WebFetch: 'webfetch',
});

const TOOLS_ORDER = ['read', 'grep', 'glob', 'bash', 'edit', 'write', 'webfetch'];
const MUTATING_OPENCODE_TOOLS = new Set(['bash', 'edit', 'write']);

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
  const enabled = new Set();

  for (const sourceTool of ir.tools) {
    const mapped = CLAUDE_TO_OPENCODE_TOOLS[sourceTool];
    if (mapped) {
      enabled.add(mapped);
    } else if (sourceTool.startsWith('mcp__')) {
      warnings.push(`${ir.id}: MCP tool ${sourceTool} not auto-mapped (configure the MCP server explicitly)`);
    } else {
      warnings.push(`${ir.id}: unmapped tool: ${sourceTool} (no OpenCode equivalent in v1)`);
    }
  }

  const toolLines = [];
  for (const tool of TOOLS_ORDER) {
    if (enabled.has(tool)) {
      toolLines.push(`  ${tool}: true`);
    } else if (MUTATING_OPENCODE_TOOLS.has(tool)) {
      toolLines.push(`  ${tool}: false`);
    }
  }

  const frontmatter = [
    '---',
    ...(ir.model ? [`# source model tier: ${ir.model}`] : []),
    `name: ${ir.name}`,
    `description: ${yamlScalar(ir.description)}`,
    'mode: subagent',
    'tools:',
    ...toolLines,
    '---',
  ];

  const body = (ir.body || '').replace(/^\n+/, '').trimEnd();
  const markdown = frontmatter.join('\n') + '\n\n' + body + '\n';
  return { markdown, warnings, tools: [...enabled] };
}

/** Emit the full set of OpenCode agents, sorted by id for determinism. */
function emitAllOpenCodeAgents(irs) {
  const results = [];
  const warnings = [];
  let modelTiers = {};
  let unsupported = 0;

  for (const ir of [...irs].sort((a, b) => a.id.localeCompare(b.id))) {
    const { markdown, warnings: w, tools } = emitOpenCodeAgent(ir);
    results.push({ id: ir.id, name: ir.name, tools, markdown });
    warnings.push(...w);

    if (ir.model) {
      modelTiers = { ...modelTiers, [ir.model]: (modelTiers[ir.model] || 0) + 1 };
    }
    unsupported += ir.tools.filter(t => !CLAUDE_TO_OPENCODE_TOOLS[t] && !t.startsWith('mcp__')).length;
    unsupported += ir.tools.filter(t => t.startsWith('mcp__')).length;
  }

  const notes = [];
  if (Object.keys(modelTiers).length) {
    const tiers = Object.entries(modelTiers).map(([t, n]) => `${t} x${n}`).join(', ');
    notes.push(`model tiers preserved as comments (${tiers}) — OpenCode selects its own model`);
  }
  if (unsupported) {
    notes.push(`unmapped tools: ${unsupported} — see warnings`);
  }

  return { results, warnings, notes };
}

module.exports = {
  CLAUDE_TO_OPENCODE_TOOLS,
  emitOpenCodeAgent,
  emitAllOpenCodeAgents,
  yamlScalar,
};
