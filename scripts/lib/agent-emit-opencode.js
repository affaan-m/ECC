#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — OpenCode emitter.
 *
 * Turns IR objects into OpenCode agent definitions. OpenCode agents live under
 * `.opencode/agent/*.md` and use frontmatter `name`, `description`, `mode`
 * (`subagent` for delegated agents), and `tools`. The prompt lives in the
 * document body.
 *
 * v1 behavior:
 *   - `mode: subagent` marks each converted agent as a subagent.
 *   - The source model tier is preserved as a YAML comment; OpenCode selects
 *     its own model, so no `model:` field is emitted.
 *   - Unmapped tools (WebSearch, mcp__*) surface as per-agent warnings; never
 *     silently dropped.
 */

const CLAUDE_TO_OPENCODE_TOOLS = Object.freeze({
  Read: 'read',
  Grep: 'grep',
  Glob: 'glob',
  Bash: 'bash',
  Edit: 'edit',
  Write: 'write',
  WebFetch: 'webfetch',
  // WebSearch intentionally unmapped: OpenCode has webfetch but no separate
  // web-search tool, so mapping it silently would over-claim capability.
});

function mapToolToOpenCode(claudeTool) {
  const name = String(claudeTool).trim();
  if (Object.prototype.hasOwnProperty.call(CLAUDE_TO_OPENCODE_TOOLS, name)) {
    return { tool: CLAUDE_TO_OPENCODE_TOOLS[name], unsupported: false };
  }
  if (name.startsWith('mcp__')) {
    return {
      tool: null,
      unsupported: true,
      note: `MCP tool ${name} not auto-mapped (configure the MCP server explicitly)`,
    };
  }
  return {
    tool: null,
    unsupported: true,
    note: `unmapped tool: ${name} (no OpenCode equivalent in v1)`,
  };
}

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
  const seen = new Set();
  const tools = [];

  for (const sourceTool of ir.tools) {
    const mapped = mapToolToOpenCode(sourceTool);
    if (mapped.tool && !seen.has(mapped.tool)) {
      seen.add(mapped.tool);
      tools.push(mapped.tool);
    }
    if (mapped.note) {
      warnings.push(`${ir.id}: ${mapped.note}`);
    }
  }

  const frontmatter = [
    '---',
    ...(ir.model ? [`# source model tier: ${ir.model}`] : []),
    `name: ${ir.name}`,
    `description: ${yamlScalar(ir.description)}`,
    'mode: subagent',
    `tools: ${tools.join(', ')}`,
    '---',
  ];

  const body = (ir.body || '').replace(/^\n+/, '').trimEnd();
  const markdown = frontmatter.join('\n') + '\n\n' + body + '\n';
  return { markdown, warnings, tools };
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
    unsupported += ir.tools.filter(t => mapToolToOpenCode(t).unsupported).length;
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
  mapToolToOpenCode,
  emitOpenCodeAgent,
  emitAllOpenCodeAgents,
  yamlScalar,
};
