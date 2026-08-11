#!/usr/bin/env node
/**
 * ECC usage bar for Codex CLI.
 *
 * Codex's native status_line only supports built-in widgets, so this renders
 * the ECC-branded bar outside the TUI — for tmux status-right or `watch`:
 *
 *   tmux:  set -g status-right '#(node <ecc>/scripts/codex/ecc-usage-bar-codex.js --tmux)'
 *   shell: watch -c -n 30 "node <ecc>/scripts/codex/ecc-usage-bar-codex.js"
 *   live:  the ecc-codex wrapper mirrors --plain output into the terminal
 *          title and an OSC 1337 user var while codex runs
 *
 * Reads the newest ~/.codex/sessions/**\/rollout-*.jsonl and renders the last
 * token_count event: rate-limit windows, context usage, and total tokens.
 * Inspired by leeguooooo/claude-code-usage-bar (MIT).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildBar, formatCountdown, buildEccLine, G } = require('../lib/statusline-render');

const TAIL_BYTES = 256 * 1024;
const TITLE_MAX_CHARS = 48;

/** Color wrappers keyed by role: 'ansi' (default), 'tmux', or 'plain'. */
function palette(mode) {
  if (mode === 'plain') {
    const id = t => t;
    return { amber: id, terracotta: id, warn: id, crit: id, dim: id };
  }
  if (mode === 'tmux') {
    return {
      amber: t => `#[fg=colour214]${t}#[default]`,
      terracotta: t => `#[fg=colour173]${t}#[default]`,
      warn: t => `#[fg=colour208]${t}#[default]`,
      crit: t => `#[fg=colour196,bold]${t}#[default]`,
      dim: t => `#[fg=colour245]${t}#[default]`,
    };
  }
  return {
    amber: t => `\x1b[38;5;214m${t}\x1b[0m`,
    terracotta: t => `\x1b[38;5;173m${t}\x1b[0m`,
    warn: t => `\x1b[38;5;208m${t}\x1b[0m`,
    crit: t => `\x1b[1;38;5;196m${t}\x1b[0m`,
    dim: t => `\x1b[2m${t}\x1b[0m`,
  };
}

/**
 * Most recently *written* rollout-*.jsonl under sessions/. Modification time
 * beats filename order: resuming an older session appends to its original
 * file, so the newest name is not always the active conversation.
 */
function findNewestSession(codexHome) {
  const sessionsDir = path.join(codexHome, 'sessions');
  const newestChildren = (dir, limit) => fs.readdirSync(dir).sort().reverse().slice(0, limit);
  try {
    const dayDirs = [];
    for (const year of newestChildren(sessionsDir, 2)) {
      for (const month of newestChildren(path.join(sessionsDir, year), 2)) {
        for (const day of newestChildren(path.join(sessionsDir, year, month), 3)) {
          dayDirs.push(path.join(sessionsDir, year, month, day));
        }
      }
    }

    let newest = null;
    for (const dir of dayDirs.slice(0, 6)) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
        const file = path.join(dir, name);
        const mtime = fs.statSync(file).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { file, mtime };
      }
    }
    return newest ? newest.file : null;
  } catch {
    return null;
  }
}

/**
 * Last token_count payload from a session file, reading only the tail.
 * @returns {{info: object, rate_limits: object}|null}
 */
function readLastTokenCount(sessionFile) {
  try {
    const stat = fs.statSync(sessionFile);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);

    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"token_count"')) continue;
      try {
        const event = JSON.parse(lines[i]);
        if (event?.payload?.type === 'token_count') return event.payload;
      } catch { /* torn line at tail boundary */ }
    }
    return null;
  } catch {
    return null;
  }
}

/** Thread UUID from session_meta, with a filename fallback for torn files. */
function readSessionId(sessionFile) {
  let fd;
  try {
    fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 64 * 1024));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    for (const line of buffer.toString('utf8').split('\n')) {
      if (!line.includes('"session_meta"')) continue;
      try {
        const event = JSON.parse(line);
        const id = event?.payload?.id;
        if (/^[0-9a-f-]{36}$/i.test(id || '')) return id;
      } catch { /* torn line in the read boundary */ }
    }
  } catch { /* try the filename */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return path.basename(sessionFile || '').match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i)?.[1] || '';
}

function stateDatabases(codexHome) {
  try {
    return fs.readdirSync(codexHome)
      .filter(name => /^state_\d+\.sqlite$/.test(name))
      .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))
      .map(name => path.join(codexHome, name));
  } catch {
    return [];
  }
}

/** Read one scalar without adding a runtime dependency. */
function queryThreadField(database, threadId, field) {
  if (!['name', 'title'].includes(field) || !/^[0-9a-f-]{36}$/i.test(threadId)) return '';
  const sql = `SELECT ${field} FROM threads WHERE id = '${threadId}' LIMIT 1;`;
  const cli = spawnSync('sqlite3', ['-readonly', database, sql], {
    encoding: 'utf8',
    timeout: 1000,
    windowsHide: true,
  });
  if (cli.status === 0) return cli.stdout.trim();

  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      return db.prepare(sql).get()?.[field] || '';
    } finally {
      db.close();
    }
  } catch {
    return '';
  }
}

function formatConversationTitle(value, maxChars = TITLE_MAX_CHARS) {
  const clean = String(value || '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  if (chars.length <= maxChars) return clean;
  const prefix = chars.slice(0, maxChars - 1).join('');
  const wordBreak = prefix.lastIndexOf(' ');
  const cut = wordBreak >= Math.floor(maxChars * 0.6) ? wordBreak : prefix.length;
  return `${prefix.slice(0, cut).trimEnd()}…`;
}

/** Codex thread name/title from its read-only local state database. */
function readConversationTitle(codexHome, sessionFile, query = queryThreadField) {
  const threadId = readSessionId(sessionFile);
  if (!threadId) return '';
  for (const database of stateDatabases(codexHome)) {
    for (const field of ['name', 'title']) {
      const title = formatConversationTitle(query(database, threadId, field));
      if (title) return title;
    }
  }
  return '';
}

/** "5h" / "7d" / "12h" from a window length in minutes. */
function windowLabel(windowMinutes) {
  if (!windowMinutes) return '';
  if (windowMinutes % 10080 === 0) return `${windowMinutes / 10080 * 7}d`;
  if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}d`;
  return `${Math.round(windowMinutes / 60)}h`;
}

function usageSegment(window, brandPaint, p) {
  const pct = Math.round(window?.used_percent ?? -1);
  if (pct < 0) return '';
  const label = windowLabel(window.window_minutes) || 'win';
  const paint = pct >= 90 ? p.crit : pct >= 80 ? p.warn : brandPaint;
  const reset = formatCountdown(window.resets_at);
  const resetStr = reset ? ` ${p.dim(`${G.reset}${reset}`)}` : '';
  return `${brandPaint(label)} ${paint(`${buildBar(pct, 6)} ${pct}%`)}${resetStr}`;
}

/**
 * Render the one-line Codex bar.
 * @param {{info: object, rate_limits: object}|null} tokenCount
 * @param {{tmux?: boolean, plain?: boolean}} options
 */
function renderBar(tokenCount, options = {}) {
  const p = palette(options.plain === true ? 'plain' : options.tmux === true ? 'tmux' : 'ansi');
  if (!tokenCount) return p.dim(`${G.hex} codex — no session data`);

  const parts = [];
  const rl = tokenCount.rate_limits || {};
  const primary = usageSegment(rl.primary, p.amber, p);
  const secondary = usageSegment(rl.secondary, p.terracotta, p);
  if (primary) parts.push(primary);
  if (secondary) parts.push(secondary);

  const info = tokenCount.info || {};
  const used = info.last_token_usage?.total_tokens ?? info.total_token_usage?.total_tokens;
  if (used && info.model_context_window) {
    const ctxPct = Math.min(100, Math.round((used / info.model_context_window) * 100));
    const paint = ctxPct >= 90 ? p.crit : ctxPct >= 75 ? p.warn : p.dim;
    parts.push(`${p.dim('ctx')} ${paint(`${ctxPct}%`)}`);
    if (options.conversationTitle) {
      parts.push(`${p.dim('chat')} ${p.terracotta(formatConversationTitle(options.conversationTitle))}`);
    }
  }
  const total = info.total_token_usage?.total_tokens;
  if (total) {
    const compact = total >= 1000000
      ? `${(total / 1000000).toFixed(1)}M`
      : `${Math.round(total / 1000)}K`;
    parts.push(p.dim(`${compact} tok`));
  }

  return `${p.terracotta(`${G.hex} codex`)} ${parts.join(` ${p.dim(`${G.sep}`)} `)}`;
}

/**
 * Codex hook status from config.toml's `[hooks.state]` table, where Codex
 * records the hooks it has reviewed and trusted. ECC's own hooks appear as
 * `ecc@ecc:hooks/codex-hooks.json:...` keys.
 * @returns {{enabled: boolean, trusted: number}}
 */
function readCodexHooks(codexHome) {
  try {
    const toml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    const entries = toml.match(/^\[hooks\.state\."[^"]+"\]/gm) || [];
    const eccHooks = entries.filter(line => line.includes('ecc@ecc'));
    return { enabled: eccHooks.length > 0, trusted: eccHooks.length };
  } catch {
    return { enabled: false, trusted: 0 };
  }
}

/** Enabled plugins from codex config.toml, ecc first (no versions in codex). */
function readCodexPlugins(codexHome) {
  try {
    const toml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    const plugins = [];
    const table = /\[plugins\."([^"]+)"\]([^[]*)/g;
    let match;
    while ((match = table.exec(toml)) !== null) {
      if (/^\s*enabled\s*=\s*true/m.test(match[2])) {
        plugins.push({ name: match[1].split('@')[0], version: '' });
      }
    }
    plugins.sort((a, b) => (a.name === 'ecc' ? -1 : b.name === 'ecc' ? 1 : a.name.localeCompare(b.name)));
    return plugins;
  } catch {
    return [];
  }
}

/**
 * Second line for --full mode, matching the Claude bar's ECC line:
 * ⬢ ECC <version> │ plugins … │ <dirname>
 */
function buildCodexEccLine(codexHome) {
  let eccVersion = '';
  try {
    eccVersion = fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();
  } catch { /* no checkout VERSION — omit */ }
  const hooks = readCodexHooks(codexHome);
  return buildEccLine({
    eccVersion,
    hooks: { enabled: hooks.enabled, profile: 'on', disabledCount: 0 },
    dirname: path.basename(process.cwd()),
  });
}

/** Active model from config.toml's top-level `model` key. */
function readCodexModel(codexHome) {
  try {
    const toml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    return toml.match(/^model\s*=\s*"([^"]+)"/m)?.[1] || '';
  } catch {
    return '';
  }
}

/**
 * Claude-style three-line bar:
 *   1. ⚡ usage windows + prompt-cache hit rate
 *   2. ✳ model │ ctx bar │ total tokens
 *   3. ⬢ ECC version │ plugins │ directory
 * @param {'ansi'|'tmux'|'plain'} mode
 * @returns {string[]}
 */
function buildFullLines(tokenCount, codexHome, mode = 'ansi', conversationTitle = '') {
  const p = palette(mode);
  const sep = ` ${p.dim(`${G.sep}`)} `;
  const info = tokenCount?.info || {};
  const rl = tokenCount?.rate_limits || {};

  const l1parts = [];
  const primary = usageSegment(rl.primary, p.amber, p);
  const secondary = usageSegment(rl.secondary, p.terracotta, p);
  if (primary) l1parts.push(primary);
  if (secondary) l1parts.push(secondary);
  const last = info.last_token_usage;
  if (last?.input_tokens > 0) {
    const cachePct = Math.round(((last.cached_input_tokens || 0) / last.input_tokens) * 100);
    l1parts.push(`${p.dim('cache')} ${cachePct >= 50 ? p.amber(`${cachePct}%`) : p.dim(`${cachePct}%`)}`);
  }
  const line1 = l1parts.length > 0
    ? `${p.amber(`${G.bolt}`)} ${l1parts.join(sep)}`
    : p.dim(`${G.bolt} no session data`);

  const l2parts = [p.amber(`${G.star} ${readCodexModel(codexHome) || 'codex'}`)];
  const used = last?.total_tokens ?? info.total_token_usage?.total_tokens;
  if (used && info.model_context_window) {
    const ctxPct = Math.min(100, Math.round((used / info.model_context_window) * 100));
    const paint = ctxPct >= 90 ? p.crit : ctxPct >= 75 ? p.warn : p.dim;
    const window = info.model_context_window >= 1000000
      ? '1M'
      : `${Math.round(info.model_context_window / 1000)}K`;
    l2parts.push(`${p.dim('ctx')} ${paint(`${buildBar(ctxPct, 10)} ${ctxPct}%`)} ${p.dim(window)}`);
    if (conversationTitle) {
      l2parts.push(`${p.dim('chat')} ${p.terracotta(formatConversationTitle(conversationTitle))}`);
    }
  }
  const total = info.total_token_usage?.total_tokens;
  if (total) {
    const compact = total >= 1000000
      ? `${(total / 1000000).toFixed(1)}M`
      : `${Math.round(total / 1000)}K`;
    l2parts.push(p.dim(`${compact} tok`));
  }
  const line2 = l2parts.join(sep);

  let line3;
  if (mode === 'ansi') {
    line3 = buildCodexEccLine(codexHome);
  } else {
    const l3parts = [];
    let eccVersion = '';
    try {
      eccVersion = fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();
    } catch { /* omit */ }
    l3parts.push(p.terracotta(`${G.hex} ECC${eccVersion ? ` ${eccVersion}` : ''}`));
    const hooks = readCodexHooks(codexHome);
    l3parts.push(hooks.enabled
      ? p.amber(`hooks on${hooks.trusted > 1 ? ` (${hooks.trusted})` : ''}`)
      : p.crit('hooks off'));
    l3parts.push(p.dim(path.basename(process.cwd())));
    line3 = l3parts.join(sep);
  }

  return [line1, line2, line3];
}

function main() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const sessionFile = findNewestSession(codexHome);
  const tokenCount = sessionFile ? readLastTokenCount(sessionFile) : null;
  const conversationTitle = sessionFile ? readConversationTitle(codexHome, sessionFile) : '';
  const tmux = process.argv.includes('--tmux');
  const mode = process.argv.includes('--plain') ? 'plain' : tmux ? 'tmux' : 'ansi';

  const lineFlag = process.argv.indexOf('--line');
  if (lineFlag !== -1) {
    const n = Number(process.argv[lineFlag + 1]);
    const lines = buildFullLines(tokenCount, codexHome, mode, conversationTitle);
    process.stdout.write((lines[n - 1] || '') + '\n');
    return;
  }
  if (process.argv.includes('--full')) {
    process.stdout.write(buildFullLines(tokenCount, codexHome, mode, conversationTitle).join('\n') + '\n');
    return;
  }
  process.stdout.write(renderBar(tokenCount, {
    tmux,
    plain: process.argv.includes('--plain'),
    conversationTitle,
  }) + '\n');
}

module.exports = { findNewestSession, readLastTokenCount, readSessionId, formatConversationTitle, readConversationTitle, windowLabel, renderBar, readCodexPlugins, readCodexHooks, buildCodexEccLine, readCodexModel, buildFullLines };

if (require.main === module) main();
