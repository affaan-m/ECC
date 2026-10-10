#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — Cursor emitter.
 *
 * Cursor restricts subagents through a single binary `readonly` frontmatter
 * flag (verified against cursor.com/docs/subagents): `readonly: true` means "no
 * file edits, no state-changing shell commands"; `readonly: false` means
 * unrestricted (inherits all parent tools). There is no per-tool allowlist, so
 * the conversion must never grant more authority than the source:
 *
 *   - read-only source (no Bash/Edit/Write)  -> `readonly: true`   (faithful)
 *   - source with Bash                       -> `readonly: false`  (faithful: Bash
 *     already implies full write + terminal)
 *   - Edit-only / Write-only / empty tools   -> LOSSY (Cursor's binary flag
 *     cannot express "write but no terminal" or "no tools"), so these are
 *     rejected unless the operator passes `--allow-lossy`.
 *
 * MCP tools have no Cursor subagent equivalent and are flagged, never silently
 * granted.
 */

const MUTATING_SOURCE_TOOLS = ['Bash', 'Edit', 'Write'];

function yamlScalar(value) {
  const s = String(value);
  if (/^\s|\s$|: |\n|\s#|^[-?*&|>#@`"'\][{}!,]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/** Classify how faithfully a source allowlist maps to Cursor's binary flag. */
function classifyCursorAuthority(tools) {
  if (tools.length === 0) return 'lossy'; // Cursor inherits parent tools; can't express "no tools"
  const mutating = tools.filter(t => MUTATING_SOURCE_TOOLS.includes(t));
  if (mutating.length === 0) return 'readonly';
  if (tools.includes('Bash')) return 'writable'; // Bash => full authority, faithful
  return 'lossy'; // Edit/Write without Bash: binary flag over-grants terminal
}

/**
 * Emit a Cursor agent definition for one IR object.
 *
 * @param {object} ir
 * @param {{ allowLossy?: boolean }} [options]
 * @returns {{ skipped?: boolean, reason?: string, markdown?: string, warnings?: string[], readOnly?: boolean }}
 */
function emitCursorAgent(ir, options = {}) {
  const { allowLossy = false } = options;
  const warnings = [];

  for (const sourceTool of ir.tools) {
    if (sourceTool.startsWith('mcp__')) {
      warnings.push(`${ir.id}: MCP tool ${sourceTool} not a Cursor subagent tool (Cursor inherits parent MCP tools; configure explicitly)`);
    }
  }

  const kind = classifyCursorAuthority(ir.tools);

  if (kind === 'lossy' && !allowLossy) {
    return {
      skipped: true,
      reason: `${ir.id}: Edit/Write-only or empty source allowlist cannot be faithfully represented by Cursor's binary readonly flag (readonly:false would over-grant terminal access); pass --allow-lossy to emit as writable`,
    };
  }

  const readOnly = kind === 'readonly';
  if (kind === 'lossy') {
    warnings.push(`${ir.id}: lossy conversion (operator-approved via --allow-lossy)`);
  }

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
  return { skipped: false, markdown, warnings, readOnly };
}

/** Emit the full set of Cursor agents, sorted by id for determinism. */
function emitAllCursorAgents(irs, options = {}) {
  const results = [];
  const skipped = [];
  const warnings = [];
  let modelTiers = {};
  let readonlyCount = 0;
  let mcpDropped = 0;

  for (const ir of [...irs].sort((a, b) => a.id.localeCompare(b.id))) {
    const out = emitCursorAgent(ir, options);
    if (out.skipped) {
      skipped.push({ id: ir.id, reason: out.reason });
      warnings.push(out.reason);
      continue;
    }
    results.push({ id: ir.id, name: ir.id, readOnly: out.readOnly, markdown: out.markdown });
    warnings.push(...out.warnings);

    if (ir.model) {
      modelTiers = { ...modelTiers, [ir.model]: (modelTiers[ir.model] || 0) + 1 };
    }
    if (out.readOnly) readonlyCount += 1;
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
  if (skipped.length) {
    notes.push(`${skipped.length} agent(s) skipped (lossy Cursor conversion — use --allow-lossy to emit as writable)`);
  }
  if (mcpDropped) {
    notes.push(`MCP tools not auto-mapped: ${mcpDropped} (configure explicitly)`);
  }

  return { results, skipped, warnings, notes };
}

module.exports = {
  MUTATING_SOURCE_TOOLS,
  classifyCursorAuthority,
  emitCursorAgent,
  emitAllCursorAgents,
  yamlScalar,
};
