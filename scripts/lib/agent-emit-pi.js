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
 *   - `model` is deliberately omitted: Claude tiers (`haiku`/`sonnet`/`opus`)
 *     are not valid Pi model ids, so Pi's default child model applies. The
 *     tier stays lossless in the IR.
 *   - Unmapped tools are never silently dropped; they surface in `warnings`.
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

  if (ir.model) {
    warnings.push(`${ir.id}: model tier '${ir.model}' omitted (Pi uses its default child model)`);
  }

  const frontmatter = [
    '---',
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
  // space, a leading special char, or a newline — otherwise keep it plain.
  if (/^\s|\s$|: |\n|\s#|^[-?*&|>#@`"'\][{}!,]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/** Emit the full set of Pi agents, sorted by id for determinism. */
function emitAllPiAgents(irs) {
  const results = [];
  const warnings = [];
  for (const ir of [...irs].sort((a, b) => a.id.localeCompare(b.id))) {
    const { markdown, warnings: w, tools } = emitPiAgent(ir);
    results.push({ id: ir.id, name: ir.name, tools, markdown });
    warnings.push(...w);
  }
  return { results, warnings };
}

module.exports = {
  PACKAGE,
  emitPiAgent,
  emitAllPiAgents,
  yamlScalar,
};
