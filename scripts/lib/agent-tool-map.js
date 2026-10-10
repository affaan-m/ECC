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
 * Pi tool names are verified against the installed
 * `@earendil-works/pi-coding-agent` `dist/core/tools/index.d.ts`:
 *   read | bash | powershell | edit | write | grep | find | ls
 * (`powershell` is Windows-only and not emitted here.)
 *
 * Security invariant: a Claude tool must never map to a Pi tool with MORE
 * authority than the source. Read-only Claude tools (Read, Grep, Glob) map to
 * read-only Pi tools (read, grep, find), never to `bash`.
 */

/** Claude tool name -> Pi tool name. */
const CLAUDE_TO_PI_TOOLS = Object.freeze({
  Read: 'read',
  Grep: 'grep',
  Glob: 'find',
  Bash: 'bash',
  Edit: 'edit',
  Write: 'write',
  // WebSearch and WebFetch are intentionally NOT mapped: Pi exposes no
  // `web_search` or `fetch_content` built-in. They fall through to the
  // "unmapped tool" warning rather than being guessed.
});

/**
 * Map one Claude tool name to a Pi tool allowlist entry.
 *
 * @param {string} claudeTool
 * @returns {{ tool: string|null, unsupported: boolean, note?: string }}
 *   `tool` is the Pi tool name, or null when unsupported. `unsupported` is
 *   true only for source tools that have no Pi built-in equivalent in v1.
 */
function mapToolToPi(claudeTool) {
  const name = String(claudeTool).trim();
  if (Object.prototype.hasOwnProperty.call(CLAUDE_TO_PI_TOOLS, name)) {
    return { tool: CLAUDE_TO_PI_TOOLS[name], unsupported: false };
  }
  if (name.startsWith('mcp__')) {
    return {
      tool: null,
      unsupported: true,
      note: `MCP tool ${name} not a Pi built-in (configure the MCP server explicitly)`,
    };
  }
  return { tool: null, unsupported: true, note: `unmapped tool: ${name} (not a Pi built-in)` };
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
