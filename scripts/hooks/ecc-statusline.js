#!/usr/bin/env node
/**
 * ECC Statusline — statusLine command
 *
 * Displays: model | task | budget Nt Nf Nm | dir ██░░ N%
 *
 * Registered in settings.json under "statusLine", not in hooks.json.
 * Reads bridge file from ecc-metrics-bridge.js and stdin from Claude Code runtime.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeSessionId, readBridge, writeBridgeAtomic } = require('../lib/session-bridge');
const { buildRateLimitSegment } = require('../lib/rate-limit-format');

const AUTO_COMPACT_BUFFER_PCT = 16.5;
const MAX_STDIN = 1024 * 1024;

/**
 * Format duration from ISO timestamp to now.
 * @param {string} isoTimestamp
 * @returns {string} e.g. "5s", "12m", "1h23m"
 */
function formatDuration(isoTimestamp) {
  if (!isoTimestamp) return '?';
  const elapsed = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
  if (elapsed < 0) return '?';
  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h${remMins}m` : `${hours}h`;
}

/**
 * Build context progress bar with ANSI colors.
 * @param {number} remaining - Raw remaining percentage from Claude Code
 * @returns {string} Colored bar string
 */
function buildContextBar(remaining) {
  if (remaining === null || remaining === undefined) return '';

  const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
  const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));

  const filled = Math.floor(used / 10);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);

  if (used < 50) return ` \x1b[32m${bar} ${used}%\x1b[0m`;
  if (used < 65) return ` \x1b[33m${bar} ${used}%\x1b[0m`;
  if (used < 80) return ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
  return ` \x1b[1;31m${bar} ${used}%\x1b[0m`;
}

/**
 * Read current in-progress task from todos directory.
 * @param {string} sessionId
 * @returns {string} Task activeForm text or empty string
 */
function readCurrentTask(sessionId) {
  try {
    const safeSessionId = sanitizeSessionId(sessionId);
    if (!safeSessionId) return '';

    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const todosDir = path.join(claudeDir, 'todos');
    if (!fs.existsSync(todosDir)) return '';

    const files = fs
      .readdirSync(todosDir)
      .filter(f => f.startsWith(safeSessionId) && f.includes('-agent-') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return '';

    const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
    const inProgress = todos.find(t => t.status === 'in_progress');
    return inProgress?.activeForm || '';
  } catch {
    return '';
  }
}

/**
 * Build the middle segment: remaining budget, then session counters.
 *
 * LOCAL (thaint): budget prefers `rate_limits.five_hour` over a dollar figure.
 * On a Claude.ai subscription nothing is billed per token, so the dollars are
 * noise while the rolling 5-hour window is the limit actually reached. Cost is
 * still shown when `rate_limits` is absent (API-key users, or before the first
 * API response), taking the native stdin `cost` field first so the segment
 * works even before ecc-metrics-bridge has written a bridge file.
 *
 * @param {object} data - Parsed stdin payload
 * @param {object|null} bridge - Metrics bridge contents, if any
 * @param {number} [nowMs] - Injectable clock, for tests
 * @returns {string} Colored segment, or empty string
 */
function buildMetricsSegment(data, bridge, nowMs) {
  const segments = [];
  const counters = [];

  const rateLimit = buildRateLimitSegment(data && data.rate_limits, nowMs);
  if (rateLimit) {
    segments.push(rateLimit);
  } else {
    const nativeCost = data && data.cost ? data.cost.total_cost_usd : undefined;
    const bridgeCost = bridge ? bridge.total_cost_usd : undefined;
    const cost = typeof nativeCost === 'number' && nativeCost > 0 ? nativeCost : bridgeCost;
    if (typeof cost === 'number' && cost > 0) counters.push(`$${cost.toFixed(2)}`);
  }

  if (bridge) {
    if (bridge.tool_count > 0) counters.push(`${bridge.tool_count}t`);
    if (bridge.files_modified_count > 0) counters.push(`${bridge.files_modified_count}f`);
    const dur = formatDuration(bridge.first_timestamp);
    if (dur !== '?') counters.push(dur);
  }

  if (counters.length > 0) segments.push(`\x1b[38;5;117m${counters.join(' ')}\x1b[0m`);
  return segments.join(' ');
}

function runStatusline() {
  let input = '';
  const stdinTimeout = setTimeout(() => process.exit(0), 3000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (input.length < MAX_STDIN) {
      input += chunk.substring(0, MAX_STDIN - input.length);
    }
  });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const data = JSON.parse(input);
      const model = data.model?.display_name || 'Claude';
      const dir = data.workspace?.current_dir || process.cwd();
      const session = data.session_id || '';
      const remaining = data.context_window?.remaining_percentage;

      const sessionId = sanitizeSessionId(session);
      const bridge = sessionId ? readBridge(sessionId) : null;

      // Write context % back to bridge for context-monitor
      if (sessionId && bridge && remaining !== null && remaining !== undefined) {
        bridge.context_remaining_pct = remaining;
        try {
          writeBridgeAtomic(sessionId, bridge);
        } catch {
          /* best effort */
        }
      }

      // Current task
      const task = sessionId ? readCurrentTask(sessionId) : '';

      // Budget and session counters
      const metricsStr = buildMetricsSegment(data, bridge);

      // Context bar
      const ctx = buildContextBar(remaining);

      // Build output
      const dirname = path.basename(dir);
      const segments = [`\x1b[2m${model}\x1b[0m`];

      if (task) {
        segments.push(`\x1b[1;97m${task}\x1b[0m`);
      }
      if (metricsStr) {
        segments.push(metricsStr);
      }
      segments.push(`\x1b[2m${dirname}\x1b[0m`);

      process.stdout.write(segments.join(' \x1b[2m\u2502\x1b[0m ') + ctx);
    } catch (err) {
      // stdout stays empty so a failed render shows a blank status line rather
      // than junk, but .claude/rules/node.md wants the reason on stderr —
      // without it a blank line is undiagnosable.
      process.stderr.write(`[ECCStatusline] render failed: ${err && err.message}\n`);
    }
  });
}

module.exports = { formatDuration, buildContextBar, readCurrentTask, buildMetricsSegment, MAX_STDIN };

if (require.main === module) runStatusline();
