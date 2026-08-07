#!/usr/bin/env node
/**
 * Default Codex TUI status line for ECC installs.
 *
 * Codex renders its native `tui.status_line` widgets directly under the input
 * composer — the in-TUI equivalent of the Claude Code statusline. Codex has
 * no API for custom status-line commands, so ECC configures the native
 * widget list (model, context, 5h/7d limits, tokens, git branch) instead.
 *
 * The key MUST live in the `[tui]` table — a top-level `status_line` is
 * silently ignored by Codex (verified against codex-cli 0.146 by capturing
 * the rendered TUI under tmux). An existing `tui.status_line` is never
 * overwritten; a stray top-level `status_line` is left in place (Codex
 * tolerates unknown top-level keys) and the working `[tui]` entry is added.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');

// Rate-limit windows are deliberately absent: the ECC bar renders 5h/7d usage
// with bars and reset countdowns, and showing "weekly 0% left" beside it just
// states the same number twice in a different direction.
const DEFAULT_WIDGETS = [
  'model-with-reasoning',
  'context-remaining',
  'git-branch',
];

function statusLineToml(widgets = DEFAULT_WIDGETS) {
  return `status_line = [${widgets.map(w => `"${w}"`).join(', ')}]\nstatus_line_use_colors = true`;
}

/** Locate the [tui] table: end of its header line and end of its section. */
function tuiSection(content) {
  const match = content.match(/^\[tui\][ \t]*$/m);
  if (!match) return null;
  const headerEnd = match.index + match[0].length;
  const nextTable = content.slice(headerEnd).search(/^\[/m);
  return {
    headerEnd,
    sectionEnd: nextTable === -1 ? content.length : headerEnd + nextTable,
  };
}

/** True when the [tui] table already defines status_line. */
function hasStatusLine(content) {
  const section = tuiSection(content);
  if (!section) return false;
  return /^[ \t]*status_line[ \t]*=/m.test(
    content.slice(section.headerEnd, section.sectionEnd)
  );
}

/**
 * Write the default tui.status_line into ~/.codex/config.toml when absent.
 * Never throws.
 * @param {{env?: object, codexHome?: string, widgets?: string[]}} options
 * @returns {{action: string, configPath?: string, reason?: string, error?: string}}
 */
function ensureCodexStatusLineDefault(options = {}) {
  try {
    const env = options.env || process.env;
    const codexHome = options.codexHome || env.CODEX_HOME
      || path.join(env.HOME || os.homedir(), '.codex');
    const configPath = path.join(codexHome, 'config.toml');
    const existing = fs.existsSync(configPath)
      ? fs.readFileSync(configPath, 'utf8')
      : '';
    if (hasStatusLine(existing)) {
      return { action: 'kept-existing', configPath };
    }
    fs.mkdirSync(codexHome, { recursive: true });

    const section = tuiSection(existing);
    let next;
    if (section) {
      next = existing.slice(0, section.headerEnd)
        + `\n${statusLineToml(options.widgets)}`
        + existing.slice(section.headerEnd);
    } else {
      const separator = existing.length === 0
        ? ''
        : existing.endsWith('\n') ? '\n' : '\n\n';
      next = `${existing}${separator}[tui]\n${statusLineToml(options.widgets)}\n`;
    }
    writeFileAtomic(configPath, next);
    return { action: 'configured', configPath };
  } catch (error) {
    return { action: 'skipped', error: error.message };
  }
}

/** Report whether config.toml carries a working tui.status_line. */
function statusLineStatus(options = {}) {
  const env = options.env || process.env;
  const codexHome = options.codexHome || env.CODEX_HOME
    || path.join(env.HOME || os.homedir(), '.codex');
  const configPath = path.join(codexHome, 'config.toml');
  const exists = fs.existsSync(configPath);
  return {
    configPath,
    exists,
    installed: exists && hasStatusLine(fs.readFileSync(configPath, 'utf8')),
  };
}

module.exports = {
  DEFAULT_WIDGETS,
  statusLineToml,
  tuiSection,
  hasStatusLine,
  ensureCodexStatusLineDefault,
  statusLineStatus,
};
