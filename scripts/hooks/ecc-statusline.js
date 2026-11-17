#!/usr/bin/env node
/**
 * ECC Statusline — statusLine command
 *
 * Displays: model | task | $cost Nt Nf Nm | dir ██░░ N%
 *
 * Registered in settings.json under "statusLine", not in hooks.json.
 * Reads bridge file from ecc-metrics-bridge.js and stdin from Claude Code runtime.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeSessionId, readBridge, writeBridgeAtomic } = require('../lib/session-bridge');

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
function buildContextBar(remaining, glyphs) {
  if (remaining === null || remaining === undefined) return '';

  const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
  const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));

  const filled = Math.floor(used / 10);
  const bar = (glyphs?.full || '\u2588').repeat(filled)
    + (glyphs?.empty || '\u2591').repeat(10 - filled);

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

function getEccVersion(plugins) {
  const ecc = plugins.find(p => p.name === 'ecc');
  if (ecc?.version) return ecc.version;
  try {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();
  } catch {
    return '';
  }
}

function sessionDurationMs(cost, bridge) {
  if (Number.isFinite(cost.total_duration_ms) && cost.total_duration_ms >= 0) {
    return cost.total_duration_ms;
  }
  const elapsed = bridge?.first_timestamp
    ? Date.now() - new Date(bridge.first_timestamp).getTime()
    : 0;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

/**
 * Assemble statusline output lines from Claude Code stdin data.
 * @param {object} data - Parsed statusLine stdin JSON
 * @param {object|null} bridge - Session bridge metrics or null
 * @param {string} task - Current in-progress task
 * @returns {string[]} Non-empty output lines
 */
function buildUsageLines(data, bridge, task) {
  const render = require('../lib/statusline-render');
  const remaining = data.context_window?.remaining_percentage;
  const cost = data.cost || {};
  const dirname = path.basename(data.workspace?.current_dir || process.cwd());

  if (process.env.ECC_STATUSLINE_COMPACT === '1') {
    const segments = [`\x1b[2m${data.model?.display_name || 'Claude'}\x1b[0m`];
    if (task) segments.push(`\x1b[1;97m${task}\x1b[0m`);
    const usage = render.buildUsageLine(data.rate_limits, null, { compact: true });
    if (usage) segments.push(usage);
    segments.push(`\x1b[2m${dirname}\x1b[0m`);
    return [segments.join(render.SEP) + buildContextBar(remaining, render.G)];
  }

  const usageLine = render.buildUsageLine(
    data.rate_limits,
    render.computeCacheStats(data.context_window?.current_usage)
  );

  const durationMs = sessionDurationMs(cost, bridge);
  const sessionLine = render.buildSessionLine({
    model: data.model?.display_name,
    effort: data.effort?.level,
    fastMode: data.fast_mode === true,
    ctxBar: buildContextBar(remaining, render.G),
    ctxWindowSize: data.context_window?.context_window_size,
    costUsd: cost.total_cost_usd ?? bridge?.total_cost_usd ?? 0,
    linesAdded: cost.total_lines_added || 0,
    linesRemoved: cost.total_lines_removed || 0,
    durationMs,
    task,
  });

  const plugins = render.readInstalledPlugins(undefined, data.workspace?.current_dir || process.cwd());
  const eccLine = render.buildEccLine({
    eccVersion: getEccVersion(plugins),
    hooks: render.getHooksSummary(),
    plugins,
    dirname,
  });

  return [usageLine, sessionLine, eccLine].filter(Boolean);
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

      if (process.env.ECC_STATUSLINE_USAGE === '1') {
        process.stdout.write(buildUsageLines(data, bridge, task).join('\n'));
        return;
      }

      // Metrics from bridge
      let metricsStr = '';
      if (bridge) {
        const parts = [];
        if (bridge.total_cost_usd > 0) {
          parts.push(`$${bridge.total_cost_usd.toFixed(2)}`);
        }
        if (bridge.tool_count > 0) {
          parts.push(`${bridge.tool_count}t`);
        }
        if (bridge.files_modified_count > 0) {
          parts.push(`${bridge.files_modified_count}f`);
        }
        const dur = formatDuration(bridge.first_timestamp);
        if (dur !== '?') {
          parts.push(dur);
        }
        if (parts.length > 0) {
          metricsStr = `\x1b[38;5;117m${parts.join(' ')}\x1b[0m`;
        }
      }

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
    } catch {
      // Silent fail
    }
  });
}

module.exports = { formatDuration, buildContextBar, readCurrentTask, buildUsageLines, MAX_STDIN };

if (require.main === module) runStatusline();
