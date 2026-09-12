#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — Cursor emitter.
 *
 * Cursor restricts subagents through a binary `readonly` frontmatter flag, not
 * a per-tool allowlist. A converted agent is therefore emitted `readonly: true`
 * only when its source allowlist contains no mutating tool (Bash, Edit, or
 * Write); otherwise it is writable. This preserves the permission boundary: a
 * read-only Claude agent never gains write or terminal access in Cursor.
 *
 * MCP tools have no Cursor equivalent and are flagged, never silently granted.
 */

const MUTATING_SOURCE_TOOLS = ['Bash', 'Edit', 'Write'];

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
  for (const sourceTool of ir.tools) {
    if (sourceTool.startsWith('mcp__')) {
      warnings.push(`${ir.id}: MCP tool ${sourceTool} not auto-mapped (configure the MCP server explicitly)`);
    }
  }

  const readOnly = !ir.tools.some(t => MUTATING_SOURCE_TOOLS.includes(t));

  const frontmatter = [
    '---',
    ...(ir.model ? [`# source model tier: ${ir.model}`] : []),
    `name: ${ir.id}`,
    `description: ${yamlScalar(ir.description)}`,
    `readonly: ${readOnly}`,
    '---',
  ];

  const body = (ir.body || '').replace(/^\n+/, '').trimEnd();
  const markdown = frontmatter.join('\n') + '\n\n' + body + '\n';
  return { markdown, warnings, readOnly };
}

/** Emit the full set of Cursor agents, sorted by id for determinism. */
function emitAllCursorAgents(irs) {
  const results = [];
  const warnings = [];
  let modelTiers = {};
  let readonlyCount = 0;
  let mcpDropped = 0;

  for (const ir of [...irs].sort((a, b) => a.id.localeCompare(b.id))) {
    const { markdown, warnings: w, readOnly } = emitCursorAgent(ir);
    results.push({ id: ir.id, name: ir.id, readOnly, markdown });
    warnings.push(...w);

    if (ir.model) {
      modelTiers = { ...modelTiers, [ir.model]: (modelTiers[ir.model] || 0) + 1 };
    }
    if (readOnly) readonlyCount += 1;
    mcpDropped += ir.tools.filter(t => t.startsWith('mcp__')).length;
  }

  const notes = [];
  if (Object.keys(modelTiers).length) {
    const tiers = Object.entries(modelTiers).map(([t, n]) => `${t} x${n}`).join(', ');
    notes.push(`model tiers preserved as comments (${tiers}) — Cursor selects its own model`);
  }
  if (readonlyCount) {
    notes.push(`${readonlyCount} agent(s) emitted as readonly: true (no Bash/Edit/Write in source)`);
  }
  if (mcpDropped) {
    notes.push(`MCP tools not auto-mapped: ${mcpDropped} (configure the server explicitly)`);
  }

  return { results, warnings, notes };
}

module.exports = {
  MUTATING_SOURCE_TOOLS,
  emitCursorAgent,
  emitAllCursorAgents,
  yamlScalar,
};
