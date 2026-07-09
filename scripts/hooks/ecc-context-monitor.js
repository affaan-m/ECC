#!/usr/bin/env node
/**
 * ECC Context Monitor — PostToolUse hook
 *
 * Reads bridge file from ecc-metrics-bridge.js and injects agent-facing
 * warnings when thresholds are crossed: context exhaustion, high cost,
 * scope creep, or tool loops.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeSessionId, readBridge, renameWithRetry } = require('../lib/session-bridge');

const CONTEXT_WARNING_PCT = 35;
const CONTEXT_CRITICAL_PCT = 25;
const COST_NOTICE_USD = 5;
const COST_WARNING_USD = 10;
const COST_CRITICAL_USD = 50;
const FILES_WARNING_COUNT = 20;
// The recent_tools ring buffer holds 5 entries (RECENT_TOOLS_SIZE in
// ecc-metrics-bridge.js), so 5 means ALL of the last 5 calls must be the
// identical tool+params before a LOOP WARNING fires. At 3, three repeats of
// a legitimate command (retries, polling) among five mixed calls fired a
// false warning.
const LOOP_THRESHOLD = 5;
const STALE_SECONDS = 60;

function isEnabledEnv(value, defaultValue = true) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  return defaultValue;
}

function costWarningsEnabled(env = process.env) {
  return isEnabledEnv(env.ECC_CONTEXT_MONITOR_COST_WARNINGS, true);
}

/**
 * Get debounce state file path.
 * @param {string} sessionId
 * @returns {string}
 */
function getWarnPath(sessionId) {
  return path.join(os.tmpdir(), `ecc-ctx-warn-${sessionId}.json`);
}

/**
 * Read debounce state.
 * @param {string} sessionId
 * @returns {object}
 */
function readWarnState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(getWarnPath(sessionId), 'utf8'));
  } catch {
    return { callsSinceWarn: 0, lastSeverity: null, lastKey: null };
  }
}

/**
 * Write debounce state atomically (unique-suffix tmp then rename).
 *
 * The tmp path includes `process.pid` plus a random nonce so concurrent
 * PostToolUse subprocesses writing to the same session's warn-state
 * file do not clobber each other's tmp mid-write. Without the unique
 * suffix, two writers race over a shared `${target}.tmp` and produce
 * either a corrupted payload or an ENOENT throw on the second rename.
 *
 * Same pattern as `writeBridgeAtomic` in `scripts/lib/session-bridge.js`
 * and `writeCostWarningIfChanged` in `scripts/hooks/ecc-metrics-bridge.js`.
 *
 * @param {string} sessionId
 * @param {object} state
 */
function writeWarnState(sessionId, state) {
  const target = getWarnPath(sessionId);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
  try {
    renameWithRetry(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Detect tool loops from recent_tools ring buffer.
 * @param {Array} recentTools
 * @returns {{detected: boolean, tool: string, count: number}}
 */
function detectLoop(recentTools) {
  if (!Array.isArray(recentTools) || recentTools.length < LOOP_THRESHOLD) {
    return { detected: false, tool: '', count: 0 };
  }
  const counts = {};
  for (const entry of recentTools) {
    const key = `${entry.tool}:${entry.hash}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(counts)) {
    if (count >= LOOP_THRESHOLD) {
      return { detected: true, tool: key.split(':')[0], count };
    }
  }
  return { detected: false, tool: '', count: 0 };
}

/**
 * Evaluate all warning conditions against bridge data.
 * Returns array of {severity, type, message} sorted by severity desc.
 */
function evaluateConditions(bridge, options = {}) {
  const warnings = [];
  const remaining = bridge.context_remaining_pct;

  // Context warnings (skip if no context data)
  if (remaining !== null && remaining !== undefined) {
    if (remaining <= CONTEXT_CRITICAL_PCT) {
      warnings.push({
        severity: 3,
        type: 'context',
        dedupeKey: 'context:critical',
        message:
          `CONTEXT CRITICAL: ${remaining}% remaining. Context nearly exhausted. ` +
          'Inform the user that context is low and ask how they want to proceed. ' +
          'Do NOT autonomously save state or write handoff files unless the user asks.'
      });
    } else if (remaining <= CONTEXT_WARNING_PCT) {
      warnings.push({
        severity: 2,
        type: 'context',
        dedupeKey: 'context:warning',
        message: `CONTEXT WARNING: ${remaining}% remaining. ` + 'Be aware that context is getting limited. Avoid starting new complex work.'
      });
    }
  }

  // Cost warnings
  if (options.costWarnings !== false) {
    const cost = bridge.total_cost_usd || 0;
    if (cost > COST_CRITICAL_USD) {
      warnings.push({
        severity: 3,
        type: 'cost',
        dedupeKey: 'cost:critical',
        message: `COST CRITICAL: session total ~$${cost.toFixed(2)} (over $${COST_CRITICAL_USD}). Informational only — not an instruction to stop.`
      });
    } else if (cost > COST_WARNING_USD) {
      warnings.push({
        severity: 2,
        type: 'cost',
        dedupeKey: 'cost:warning',
        message: `COST WARNING: session total ~$${cost.toFixed(2)} (over $${COST_WARNING_USD}). Informational only.`
      });
    } else if (cost > COST_NOTICE_USD) {
      warnings.push({
        severity: 1,
        type: 'cost',
        dedupeKey: 'cost:notice',
        message: `COST NOTICE: session total ~$${cost.toFixed(2)}. Informational only.`
      });
    }
  }

  // File scope warning
  const fileCount = bridge.files_modified_count || 0;
  if (fileCount > FILES_WARNING_COUNT) {
    warnings.push({
      severity: 2,
      type: 'scope',
      dedupeKey: 'scope',
      message: `SCOPE WARNING: ${fileCount} files modified this session. ` + 'Consider whether changes are too scattered.'
    });
  }

  // Loop detection
  const loop = detectLoop(bridge.recent_tools);
  if (loop.detected) {
    warnings.push({
      severity: 2,
      type: 'loop',
      // The message itself is a stable key: same tool looping again is a
      // duplicate; a different tool or count is a new event.
      message: `LOOP WARNING: Tool '${loop.tool}' called ${loop.count} times ` + 'with same parameters in last 5 calls. This may indicate a stuck loop.'
    });
  }

  return warnings.sort((a, b) => b.severity - a.severity);
}

/**
 * Map numeric severity to label.
 */
function severityLabel(n) {
  if (n >= 3) return 'critical';
  if (n >= 2) return 'warning';
  return 'notice';
}

/**
 * @param {string} rawInput - Raw JSON string from stdin
 * @returns {string} JSON output with additionalContext or pass-through
 */
function run(rawInput) {
  try {
    const input = rawInput.trim() ? JSON.parse(rawInput) : {};

    const sessionId = sanitizeSessionId(input.session_id) || sanitizeSessionId(process.env.ECC_SESSION_ID) || sanitizeSessionId(process.env.CLAUDE_SESSION_ID);

    if (!sessionId) return rawInput;

    const bridge = readBridge(sessionId);
    if (!bridge) return rawInput;

    // Stale check for context warnings
    const now = Math.floor(Date.now() / 1000);
    const lastTs = bridge.last_timestamp ? Math.floor(new Date(bridge.last_timestamp).getTime() / 1000) : 0;
    const isStale = lastTs > 0 && now - lastTs > STALE_SECONDS;

    // If bridge is stale, null out context data (still check cost/scope/loop)
    const evalBridge = isStale ? { ...bridge, context_remaining_pct: null } : bridge;

    const warnings = evaluateConditions(evalBridge, { costWarnings: costWarningsEnabled() });
    if (warnings.length === 0) {
      // Clear dedupe state when the condition resolves, so the SAME warning text
      // recurring later (context dips, recovers, dips again; a loop that stops
      // then restarts) is surfaced again instead of being suppressed as a
      // duplicate. Only write when there is state to clear — most tool calls
      // have no warning, and this keeps the common path free of disk writes.
      const prior = readWarnState(sessionId);
      if (prior.lastKey || prior.lastMessage) {
        writeWarnState(sessionId, { callsSinceWarn: 0, lastSeverity: null, lastKey: null });
      }
      return rawInput;
    }

    // Combine top 2 warnings
    const top = warnings.slice(0, 2);
    const message = top.map(w => w.message).join('\n');

    // Dedupe on the warning TIER (dedupeKey), not the message text. Message
    // text embeds continuously-moving numbers (cost in dollars, context %),
    // so text-based dedupe re-emitted the "same" warning on nearly every
    // tool call — a COST NOTICE fired once per call for the rest of the
    // session once cost passed $5. Each tier now fires once (notice →
    // warning → critical each re-fire on escalation), and a genuinely new
    // event (different loop, tier change) still surfaces.
    const dedupeKey = top.map(w => w.dedupeKey || w.message).join('\n');
    const warnState = readWarnState(sessionId);
    const topSeverity = severityLabel(warnings[0].severity);
    const escalatedToCritical = topSeverity === 'critical' && warnState.lastSeverity !== 'critical';
    const sameKey = warnState.lastKey === dedupeKey;

    if (sameKey && !escalatedToCritical) {
      return rawInput;
    }

    warnState.lastSeverity = topSeverity;
    warnState.lastKey = dedupeKey;
    writeWarnState(sessionId, warnState);

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message
      }
    };

    return JSON.stringify(output);
  } catch {
    // Never block tool execution
    return rawInput;
  }
}

if (require.main === module) {
  let data = '';
  const MAX_STDIN = 1024 * 1024;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) data += chunk.substring(0, MAX_STDIN - data.length);
  });
  process.stdin.on('end', () => {
    process.stdout.write(run(data));
    process.exit(0);
  });
}

module.exports = { run, evaluateConditions, detectLoop, severityLabel, costWarningsEnabled };
