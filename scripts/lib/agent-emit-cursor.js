#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — Cursor emitter.
 *
 * Turns IR objects into Cursor agent definitions (`.cursor/agents/*.md`).
 * Cursor's exact agent `tools:` vocabulary is version-dependent, so v1 maps
 * only the tool names confirmed in Cursor's public docs and leaves the rest
 * unmapped — surfaced as warnings — rather than guessing.
 *
 * v1 behavior:
 *   - `name` is the kebab-case agent id (Cursor requires lowercase/hyphens).
 *   - The source model tier is preserved as a YAML comment; Cursor selects its
 *     own model, so no `model:` field is emitted.
 *   - Unmapped tools (Write, WebSearch, WebFetch, mcp__*) are never silently
 *     dropped; they surface as per-agent warnings.
 */

const CLAUDE_TO_CURSOR_TOOLS = Object.freeze({
  Read: 'read_file',
  Grep: 'grep_search',
  Glob: 'list_dir', // closest documented Cursor tool to file/glob listing
  Bash: 'run_terminal_cmd',
  Edit: 'edit_file',
  // Write, WebSearch, WebFetch intentionally unmapped in v1: their Cursor tool
  // names are not stable across builds and are not pinned by ECC's installer
  // (which copies agent files verbatim).
});

function mapToolToCursor(claudeTool) {
  const name = String(claudeTool).trim();
  if (Object.prototype.hasOwnProperty.call(CLAUDE_TO_CURSOR_TOOLS, name)) {
    return { tool: CLAUDE_TO_CURSOR_TOOLS[name], unsupported: false };
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
    note: `unmapped tool: ${name} (verify the Cursor tool name before enabling)`,
  };
}

function yamlScalar(value) {
  const s = String(value);
  if (/^\s|\s$|: |\n|\s#|^[-?*&|>#@`"'\][{}!,]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/** Emit a Cursor agent definition for one IR object. */
function emitCursorAgent(ir) {
  const warnings = [];
  const seen = new Set();
  const tools = [];

  for (const sourceTool of ir.tools) {
    const mapped = mapToolToCursor(sourceTool);
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
    `name: ${ir.id}`,
    `description: ${yamlScalar(ir.description)}`,
    `tools: ${tools.join(', ')}`,
    '---',
  ];

  const body = (ir.body || '').replace(/^\n+/, '').trimEnd();
  const markdown = frontmatter.join('\n') + '\n\n' + body + '\n';
  return { markdown, warnings, tools };
}

/** Emit the full set of Cursor agents, sorted by id for determinism. */
function emitAllCursorAgents(irs) {
  const results = [];
  const warnings = [];
  let modelTiers = {};
  let unsupported = 0;

  for (const ir of [...irs].sort((a, b) => a.id.localeCompare(b.id))) {
    const { markdown, warnings: w, tools } = emitCursorAgent(ir);
    results.push({ id: ir.id, name: ir.id, tools, markdown });
    warnings.push(...w);

    if (ir.model) {
      modelTiers = { ...modelTiers, [ir.model]: (modelTiers[ir.model] || 0) + 1 };
    }
    unsupported += ir.tools.filter(t => {
      const m = mapToolToCursor(t);
      return m.unsupported;
    }).length;
  }

  const notes = [];
  if (Object.keys(modelTiers).length) {
    const tiers = Object.entries(modelTiers).map(([t, n]) => `${t} x${n}`).join(', ');
    notes.push(`model tiers preserved as comments (${tiers}) — Cursor selects its own model`);
  }
  if (unsupported) {
    notes.push(`unmapped tools: ${unsupported} (Cursor tool names are version-dependent) — see warnings`);
  }

  return { results, warnings, notes };
}

module.exports = {
  CLAUDE_TO_CURSOR_TOOLS,
  mapToolToCursor,
  emitCursorAgent,
  emitAllCursorAgents,
  yamlScalar,
};
