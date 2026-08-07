#!/usr/bin/env node
/**
 * Shared rendering helpers for the ECC usage bar statusline.
 *
 * Inspired by leeguooooo/claude-code-usage-bar (MIT). ECC re-implementation
 * with brand colors, hooks/plugin awareness, and no external dependencies.
 *
 * Colors use 256-color ANSI so macOS Terminal.app renders them correctly.
 * Brand palette (from assets/ecc-icon.svg): amber #F59E0B ~ 214,
 * terracotta #E07856 ~ 173.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { areHooksEnabled, getHookProfile, getDisabledHookIds } = require('./hook-flags');

const C = {
  amber: '\x1b[38;5;214m',
  terracotta: '\x1b[38;5;173m',
  yellow: '\x1b[38;5;220m',
  orange: '\x1b[38;5;208m',
  red: '\x1b[1;38;5;196m',
  green: '\x1b[38;5;114m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

const UNICODE_GLYPHS = {
  full: '█', empty: '░', sep: '│', bolt: '⚡', star: '✳', hex: '⬢', reset: '↻', dot: '·',
};
const ASCII_GLYPHS = {
  full: '|', empty: '_', sep: '|', bolt: '*', star: '*', hex: '#', reset: '~', dot: '-',
};

/**
 * Glyphs degrade to ASCII when the environment cannot be trusted to render
 * block/box characters: tmux mangles them to underscores without a UTF-8
 * locale, and fonts such as Terminal.app's default lack ⬢/✳.
 * Force either set with ECC_BAR_GLYPHS=ascii|unicode.
 */
function glyphSet(env = process.env) {
  const forced = String(env.ECC_BAR_GLYPHS || '').trim().toLowerCase();
  if (forced === 'ascii') return ASCII_GLYPHS;
  if (forced === 'unicode') return UNICODE_GLYPHS;
  const locale = `${env.LC_ALL || ''} ${env.LC_CTYPE || ''} ${env.LANG || ''}`.toLowerCase();
  return locale.includes('utf') ? UNICODE_GLYPHS : ASCII_GLYPHS;
}

const G = glyphSet();
const SEP = ` ${C.dim}${G.sep}${C.reset} `;

/**
 * Severity color for a usage percentage: brand color while healthy,
 * warm ramp as the window fills up.
 * @param {number} pct - 0..100 used
 * @param {string} brandColor - color to use below 60%
 */
function pctColor(pct, brandColor = C.amber) {
  if (pct >= 90) return C.red;
  if (pct >= 80) return C.orange;
  if (pct >= 60) return C.yellow;
  return brandColor;
}

/**
 * Block bar for a percentage. Uses the same glyphs as the context bar.
 * @param {number} pct - 0..100 used
 * @param {number} width - bar width in cells
 */
function buildBar(pct, width = 8) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((clamped / 100) * width);
  return G.full.repeat(filled) + G.empty.repeat(width - filled);
}

/**
 * Countdown until a unix-seconds timestamp: "42m", "1h42m", "3d".
 * @param {number} epochSecs
 * @returns {string} countdown or '' when invalid/past
 */
function formatCountdown(epochSecs) {
  if (!epochSecs || typeof epochSecs !== 'number') return '';
  const secs = Math.floor(epochSecs - Date.now() / 1000);
  if (secs <= 0) return '';
  const mins = Math.ceil(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rem = mins % 60;
    return rem > 0 ? `${hours}h${rem}m` : `${hours}h`;
  }
  return `${Math.round(hours / 24)}d`;
}

/**
 * Wall-clock duration from milliseconds: "5s", "12m", "3h11m".
 * @param {number} ms
 */
function formatMs(ms) {
  if (!ms || ms < 0) return '';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h${rem}m` : `${hours}h`;
}

/**
 * Prompt-cache stats from context_window.current_usage.
 * @returns {{hitPct: number}|null} null when there is no usage data yet
 */
function computeCacheStats(currentUsage) {
  if (!currentUsage || typeof currentUsage !== 'object') return null;
  const read = currentUsage.cache_read_input_tokens || 0;
  const write = currentUsage.cache_creation_input_tokens || 0;
  const fresh = currentUsage.input_tokens || 0;
  const total = read + write + fresh;
  if (total <= 0) return null;
  return { hitPct: Math.round((read / total) * 100) };
}

function usageSegment(label, labelColor, window) {
  const pct = Math.round(window?.used_percentage ?? -1);
  if (pct < 0) return '';
  const color = pctColor(pct, labelColor);
  const reset = formatCountdown(window.resets_at);
  const resetStr = reset ? ` ${C.dim}${G.reset}${reset}${C.reset}` : '';
  return `${labelColor}${label}${C.reset} ${color}${buildBar(pct)} ${pct}%${C.reset}${resetStr}`;
}

/**
 * Line 1: rate-limit windows + prompt cache.
 * Returns '' when no rate limit data is available (e.g. API-key billing).
 */
function buildUsageLine(rateLimits, cacheStats) {
  const parts = [];
  const fiveHour = usageSegment('5h', C.amber, rateLimits?.five_hour);
  const sevenDay = usageSegment('7d', C.terracotta, rateLimits?.seven_day);
  if (fiveHour) parts.push(fiveHour);
  if (sevenDay) parts.push(sevenDay);
  if (cacheStats && parts.length > 0) {
    const cacheColor = cacheStats.hitPct >= 50 ? C.green : C.dim;
    parts.push(`${C.dim}cache${C.reset} ${cacheColor}${cacheStats.hitPct}%${C.reset}`);
  }
  if (parts.length === 0) return '';
  return `${C.amber}${G.bolt}${C.reset} ${parts.join(SEP)}`;
}

/**
 * Line 2: model, mode, context bar, cost, diff, duration, current task.
 */
function buildSessionLine(info) {
  const parts = [];
  let model = `${C.amber}${G.star} ${info.model || 'Claude'}${C.reset}`;
  const badges = [];
  if (info.effort && info.effort !== 'high') badges.push(info.effort);
  if (info.fastMode) badges.push('fast');
  if (badges.length > 0) model += ` ${C.dim}${badges.join(' ')}${C.reset}`;
  parts.push(model);

  if (info.ctxBar) {
    const size = info.ctxWindowSize >= 1000000
      ? '1M'
      : info.ctxWindowSize ? `${Math.round(info.ctxWindowSize / 1000)}K` : '';
    const sizeStr = size ? ` ${C.dim}${size}${C.reset}` : '';
    parts.push(`${C.dim}ctx${C.reset}${info.ctxBar}${sizeStr}`);
  }

  const metrics = [];
  if (info.costUsd > 0) metrics.push(`$${info.costUsd.toFixed(2)}`);
  if (info.linesAdded > 0 || info.linesRemoved > 0) {
    metrics.push(`+${info.linesAdded || 0}/-${info.linesRemoved || 0}`);
  }
  const dur = formatMs(info.durationMs);
  if (dur) metrics.push(dur);
  if (metrics.length > 0) parts.push(`\x1b[38;5;117m${metrics.join(' ')}${C.reset}`);

  if (info.task) parts.push(`\x1b[1;97m${info.task}${C.reset}`);
  return parts.join(SEP);
}

/**
 * Line 3: ECC version, hooks status, enabled plugins with versions, directory.
 */
function buildEccLine(info) {
  const parts = [];
  const version = info.eccVersion ? ` ${info.eccVersion}` : '';
  parts.push(`${C.terracotta}${G.hex} ECC${version}${C.reset}`);

  if (info.hooks) {
    const h = info.hooks;
    let hookStr;
    if (!h.enabled) hookStr = `${C.red}hooks off${C.reset}`;
    else {
      const off = h.disabledCount > 0 ? ` ${C.dim}(${h.disabledCount} off)${C.reset}` : '';
      hookStr = `${C.green}hooks ${h.profile}${C.reset}${off}`;
    }
    parts.push(hookStr);
  }

  if (Array.isArray(info.plugins) && info.plugins.length > 0) {
    const shown = info.plugins.slice(0, 4)
      .map(p => `${p.name}${p.version ? ` ${C.dim}${p.version}${C.reset}` : ''}`);
    const more = info.plugins.length > 4 ? ` ${C.dim}+${info.plugins.length - 4}${C.reset}` : '';
    parts.push(`${C.dim}plugins${C.reset} ${shown.join(` ${G.dot} `)}${more}`);
  }

  if (info.dirname) parts.push(`${C.dim}${info.dirname}${C.reset}`);
  return parts.join(SEP);
}

/**
 * Enabled plugins with versions, ecc first.
 * Reads installed_plugins.json (v2) and settings.json enabledPlugins.
 * @param {string} [claudeDir] - defaults to CLAUDE_CONFIG_DIR or ~/.claude
 * @returns {Array<{name: string, version: string}>}
 */
function readInstalledPlugins(claudeDir) {
  try {
    const dir = claudeDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const installed = JSON.parse(
      fs.readFileSync(path.join(dir, 'plugins', 'installed_plugins.json'), 'utf8')
    );
    let enabled = null;
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
      if (settings.enabledPlugins && typeof settings.enabledPlugins === 'object') {
        enabled = settings.enabledPlugins;
      }
    } catch { /* no settings — show all installed */ }

    const plugins = [];
    for (const [id, entries] of Object.entries(installed?.plugins || {})) {
      if (enabled && enabled[id] === false) continue;
      const entry = Array.isArray(entries) ? entries[0] : entries;
      plugins.push({ name: id.split('@')[0], version: entry?.version || '' });
    }
    plugins.sort((a, b) => (a.name === 'ecc' ? -1 : b.name === 'ecc' ? 1 : a.name.localeCompare(b.name)));
    return plugins;
  } catch {
    return [];
  }
}

/**
 * Hooks status summary from ECC hook flags (env + managed config).
 */
function getHooksSummary(env = process.env) {
  return {
    enabled: areHooksEnabled(env),
    profile: getHookProfile(env),
    disabledCount: getDisabledHookIds(env).size,
  };
}

module.exports = {
  C,
  G,
  SEP,
  UNICODE_GLYPHS,
  ASCII_GLYPHS,
  glyphSet,
  pctColor,
  buildBar,
  formatCountdown,
  formatMs,
  computeCacheStats,
  buildUsageLine,
  buildSessionLine,
  buildEccLine,
  readInstalledPlugins,
  getHooksSummary,
};
