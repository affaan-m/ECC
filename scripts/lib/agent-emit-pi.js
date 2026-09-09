#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — Pi emitter.
 *
 * Turns one IR object into a native Pi subagent definition (markdown file with
 * Pi frontmatter). Pi agent files use frontmatter fields `name`, `package`,
 * `description`, `tools` (a comma-separated strict child allowlist), and
 * `systemPromptMode`; the body after the frontmatter is the child system
 * prompt. See the `pi-subagents` package `management-authoring-rpc.md` for the
 * authoritative schema.
 *
 * v1 behavior:
 *   - `package: ecc` namespaces agents as `ecc.<name>` to avoid collisions with
 *     Pi builtin agents (e.g. `reviewer`).
 *   - The source model tier is preserved as a YAML comment
 *     (`# source model tier: opus`) rather than a `model:` field, because
 *     Claude tiers are not valid Pi model ids. Pi's default child model
 *     applies; the tier is lossless in the IR and visible in the emitted file.
 *   - Unmapped tools are never silently dropped; they surface in `warnings`
 *     (per-agent) and in the aggregate `summary`.
 */

const { mapToolToPi } = require('./agent-tool-map');

const PACKAGE = 'ecc';

/**
 * Emit a Pi agent definition for one IR object.
 *
 * @param {object} ir
 * @returns {{ markdown: string, warnings: string[], tools: string[] }}
 */
function emitPiAgent(ir) {
  const warnings = [];
  const seen = new Set();
  const tools = [];

  for (const sourceTool of ir.tools) {
    const mapped = mapToolToPi(sourceTool);
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
    `name: ${yamlScalar(ir.name)}`,
    `package: ${PACKAGE}`,
    `description: ${yamlScalar(ir.description)}`,
    `tools: ${tools.join(', ')}`,
    'systemPromptMode: replace',
    '---',
  ];

  const body = (ir.body || '').replace(/^\n+/, '').trimEnd();
  const markdown = frontmatter.join('\n') + '\n\n' + body + '\n';
  return { markdown, warnings, tools };
}

/** Emit a single-line YAML scalar, quoted only when needed. */
function yamlScalar(value) {
  const s = String(value);
  // Quote when it contains a leading/trailing space, a colon followed by a
  // space, a comment-starting hash, a leading special char, or a newline.
  if (/^\s|\s$|: |\n|\s#|^[-?*&|>#@`"'\][{}!,]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/**
 * Emit the full set of Pi agents, sorted by id for determinism, plus an
 * aggregate summary of the deliberate (documented) lossy conversions.
 *
 * @param {object[]} irs
 * @returns {{ results: object[], warnings: string[], summary: object }}
 */
function emitAllPiAgents(irs) {
  const results = [];
  const warnings = [];
  const modelTiers = {};
  let globApproximated = 0;
  let mcpDropped = 0;

  for (const ir of [...irs].sort((a, b) => a.id.localeCompare(b.id))) {
    const { markdown, warnings: w, tools } = emitPiAgent(ir);
    results.push({ id: ir.id, name: ir.name, tools, markdown });
    warnings.push(...w);

    if (ir.model) {
      modelTiers[ir.model] = (modelTiers[ir.model] || 0) + 1;
    }
    if (ir.tools.includes('Glob')) {
      globApproximated += 1;
    }
    mcpDropped += ir.tools.filter(t => t.startsWith('mcp__')).length;
  }

  const notes = [];
  if (Object.keys(modelTiers).length) {
    const tiers = Object.entries(modelTiers).map(([t, n]) => `${t} x${n}`).join(', ');
    notes.push(`model tiers preserved as comments (${tiers}) — Pi uses its default child model`);
  }
  if (globApproximated) {
    notes.push(`Glob mapped to anchor_grep (read-only approximation; Pi has no pure file-listing tool) for ${globApproximated} agent(s)`);
  }
  if (mcpDropped) {
    notes.push(`MCP tools not auto-mapped: ${mcpDropped} (configure the server explicitly)`);
  }

  return { results, warnings, notes };
}

module.exports = {
  PACKAGE,
  emitPiAgent,
  emitAllPiAgents,
  yamlScalar,
};
