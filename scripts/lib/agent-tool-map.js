#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — tool and model mapping tables.
 *
 * The IR stores source (Claude) tool names verbatim. Each emitter maps those
 * names to its own harness primitives through a table. Unmapped tools are
 * never silently dropped: they are surfaced as `unsupported` so the emitter
 * can warn and the conformance test can assert the mapping is complete.
 *
 * Security invariant: a Claude tool must never map to a Pi tool with MORE
 * authority than the source. Read-only Claude tools (Read, Grep, Glob) map to
 * read-only Pi tools, never to `bash`.
 */

/** Claude tool name -> Pi tool name. */
const CLAUDE_TO_PI_TOOLS = Object.freeze({
  Read: 'read',
  Grep: 'anchor_grep',
  // Read-only approximation, documented in the conversion summary: Pi has no
  // pure file-listing tool. anchor_grep accepts a glob filter (so it can scope
  // searches), and mapping Glob -> bash would give read-only agents shell
  // execution, which would weaken the permission boundary.
  Glob: 'anchor_grep',
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
    // Never collapse `mcp__server__operation` onto Pi's single `mcp` gateway:
    // that would let an agent restricted to one operation invoke every enabled
    // gateway operation. The operator must wire the server explicitly.
    return {
      tool: null,
      unsupported: true,
      note: `MCP tool ${name} not auto-mapped (shared gateway would over-grant); configure the MCP server explicitly`,
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
