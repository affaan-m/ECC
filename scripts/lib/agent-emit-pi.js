#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — Pi emitter.
 *
 * Turns one IR object into a native Pi subagent definition (markdown file with
 * Pi frontmatter). The frontmatter contract is verified against
 * `@tintinweb/pi-subagents@0.19.0`: fields are `name` (the dispatch id),
 * `description`, `tools` (a comma-separated strict child allowlist), and
 * `prompt_mode` (`replace` keeps the body as the complete system prompt). The
 * prompt lives in the document body.
 *
 * v1 behavior:
 *   - The source model tier is preserved as a YAML comment
 *     (`# source model tier: opus`) rather than a `model:` field, because
 *     Claude tiers are not valid Pi model ids. Pi's default child model
 *     applies; the tier is lossless in the IR and visible in the emitted file.
 *   - Unmapped tools (WebSearch, WebFetch, mcp__*) are never silently dropped;
 *     they surface in per-agent `warnings`.
 *   - The allowlist is always written. An empty allowlist is emitted as
 *     `tools: none`, never blank, because the companion's `csvList` treats a
 *     blank/missing `tools:` as *all* built-ins — which would escalate a
 *     fully-unmapped agent to every tool.
 */

const { mapToolToPi } = require('./agent-tool-map');

// Pi core built-in agent names (case-sensitive). ECC agent names are kebab-case
// and do not collide today; warn if a future one ever does.
const RESERVED_AGENT_NAMES = new Set(['general-purpose', 'Explore', 'Plan']);

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

  if (RESERVED_AGENT_NAMES.has(ir.name)) {
    warnings.push(`${ir.id}: name '${ir.name}' collides with a Pi built-in agent; rename to avoid shadowing`);
  }

  // Never emit a blank allowlist: `none` is the explicit "no tools" sentinel.
  const toolsValue = tools.length > 0 ? tools.join(', ') : 'none';

  const frontmatter = [
    '---',
    ...(ir.model ? [`# source model tier: ${ir.model}`] : []),
    `name: ${yamlScalar(ir.name)}`,
    `description: ${yamlScalar(ir.description)}`,
    `tools: ${toolsValue}`,
    'prompt_mode: replace',
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
 * Emit the full set of Pi agents, sorted by id for determinism, plus notes on
 * the deliberate (documented) lossy conversions.
 *
 * @param {object[]} irs
 * @returns {{ results: object[], warnings: string[], notes: string[] }}
 */
function emitAllPiAgents(irs) {
  const results = [];
  const warnings = [];
  let modelTiers = {};
  let unsupported = 0;

  for (const ir of [...irs].sort((a, b) => a.id.localeCompare(b.id))) {
    const { markdown, warnings: w, tools } = emitPiAgent(ir);
    results.push({ id: ir.id, name: ir.name, tools, markdown });
    warnings.push(...w);

    if (ir.model) {
      modelTiers = { ...modelTiers, [ir.model]: (modelTiers[ir.model] || 0) + 1 };
    }
    unsupported += ir.tools.filter(t => mapToolToPi(t).unsupported).length;
  }

  const notes = [];
  if (Object.keys(modelTiers).length) {
    const tiers = Object.entries(modelTiers).map(([t, n]) => `${t} x${n}`).join(', ');
    notes.push(`model tiers preserved as comments (${tiers}) — Pi uses its default child model`);
  }
  if (unsupported) {
    notes.push(`unmapped tools: ${unsupported} (WebSearch/WebFetch/mcp__* are not Pi built-ins) — see warnings`);
  }

  return { results, warnings, notes };
}

module.exports = {
  RESERVED_AGENT_NAMES,
  emitPiAgent,
  emitAllPiAgents,
  yamlScalar,
};
