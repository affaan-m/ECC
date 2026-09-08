#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — tool and model mapping tables.
 *
 * The IR stores source (Claude) tool names verbatim. Each emitter maps those
 * names to its own harness primitives through a table. Unmapped tools are
 * never silently dropped: they are surfaced as `unsupported` so the emitter
 * can warn and the conformance test can assert the mapping is complete.
 */

/** Claude tool name -> Pi tool name. */
const CLAUDE_TO_PI_TOOLS = Object.freeze({
  Read: 'read',
  Grep: 'anchor_grep',
  Glob: 'bash', // Pi discovers files via bash (ls/find); anchor_grep also accepts globs
  Bash: 'bash',
  Edit: 'replace',
  Write: 'write',
  WebSearch: 'web_search',
  WebFetch: 'fetch_content',
});

/**
 * Map one Claude tool name to a Pi tool allowlist entry.
 *
 * @param {string} claudeTool
 * @returns {{ tool: string|null, unsupported: boolean, note?: string }}
 *   `tool` is the Pi tool name, or null when unsupported. `unsupported` is
 *   true only for source tools that have no Pi equivalent in v1.
 */
function mapToolToPi(claudeTool) {
  const name = String(claudeTool).trim();
  if (Object.prototype.hasOwnProperty.call(CLAUDE_TO_PI_TOOLS, name)) {
    return { tool: CLAUDE_TO_PI_TOOLS[name], unsupported: false };
  }
  if (name.startsWith('mcp__')) {
    // Pi exposes MCP servers through the single `mcp` gateway tool. The
    // specific server tool (`mcp__playwright__browser_navigate`, etc.) resolves
    // at call time once that server is connected; v1 maps the whole family to
    // `mcp` and flags it so the operator knows to connect the server.
    return {
      tool: 'mcp',
      unsupported: false,
      note: `mcp family (${name}) -> mcp (server must be connected)`,
    };
  }
  return { tool: null, unsupported: true, note: `unmapped tool: ${name}` };
}

/**
 * Claude model tiers. Pi resolves its own child model; v1 does not emit a
 * `model` field, so Pi's default applies. The tier is retained in the IR for
 * lossless round-trips and for emitters that do have a model table.
 */
const CLAUDE_MODEL_TIERS = Object.freeze(['haiku', 'sonnet', 'opus']);

module.exports = {
  CLAUDE_TO_PI_TOOLS,
  CLAUDE_MODEL_TIERS,
  mapToolToPi,
};
