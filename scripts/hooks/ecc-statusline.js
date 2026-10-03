#!/usr/bin/env node
/**
 * ECC Statusline — statusLine command
 *
 * ECC usage bar, inspired by leeguooooo/claude-code-usage-bar (MIT).
 * Renders three lines:
 *   1. ⚡ 5h/7d rate-limit bars with reset countdowns + prompt-cache hit rate
 *   2. ✳ model + effort/fast badges │ context bar │ $cost +add/-del duration │ task
 *   3. ⬢ ECC version │ hooks profile │ plugins with versions │ directory
 *
 * Set ECC_STATUSLINE_COMPACT=1 for the legacy single-line format.
 * Registered in settings.json under "statusLine", not in hooks.json.
 * Reads bridge file from ecc-metrics-bridge.js and stdin from Claude Code runtime.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeSessionId, readBridge, writeBridgeAtomic } = require('../lib/session-bridge');
const render = require('../lib/statusline-render');

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
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

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
 * ECC version: installed plugin version first, repo VERSION file as fallback.
 * @param {Array<{name: string, version: string}>} plugins
 */
function getEccVersion(plugins) {
  const ecc = plugins.find(p => p.name === 'ecc');
  if (ecc?.version) return ecc.version;
  try {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Assemble statusline output lines from Claude Code stdin data.
 * @param {object} data - Parsed statusLine stdin JSON
 * @param {object|null} bridge - Session bridge metrics or null
 * @param {string} task - Current in-progress task
 * @returns {string[]} Non-empty output lines
 */
function buildLines(data, bridge, task) {
  const remaining = data.context_window?.remaining_percentage;
  const cost = data.cost || {};
  const dirname = path.basename(data.workspace?.current_dir || process.cwd());

  if (process.env.ECC_STATUSLINE_COMPACT === '1') {
    const segments = [`\x1b[2m${data.model?.display_name || 'Claude'}\x1b[0m`];
    if (task) segments.push(`\x1b[1;97m${task}\x1b[0m`);
    segments.push(`\x1b[2m${dirname}\x1b[0m`);
    return [segments.join(render.SEP) + buildContextBar(remaining)];
  }

  const usageLine = render.buildUsageLine(
    data.rate_limits,
    render.computeCacheStats(data.context_window?.current_usage)
  );

  const durationMs = bridge?.first_timestamp
    ? Date.now() - new Date(bridge.first_timestamp).getTime()
    : 0;
  const sessionLine = render.buildSessionLine({
    model: data.model?.display_name,
    effort: data.effort?.level,
    fastMode: data.fast_mode === true,
    ctxBar: buildContextBar(remaining),
    ctxWindowSize: data.context_window?.context_window_size,
    costUsd: cost.total_cost_usd ?? bridge?.total_cost_usd ?? 0,
    linesAdded: cost.total_lines_added || 0,
    linesRemoved: cost.total_lines_removed || 0,
    durationMs,
    task,
  });

  const plugins = render.readInstalledPlugins();
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
      const remaining = data.context_window?.remaining_percentage;
      const sessionId = sanitizeSessionId(data.session_id || '');
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

      const task = sessionId ? readCurrentTask(sessionId) : '';
      process.stdout.write(buildLines(data, bridge, task).join('\n'));
    } catch {
      // Silent fail
    }
  });
}

module.exports = { formatDuration, buildContextBar, readCurrentTask, getEccVersion, buildLines, runStatusline, MAX_STDIN };

if (require.main === module) runStatusline();
