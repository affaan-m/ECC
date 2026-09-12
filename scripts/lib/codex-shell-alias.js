#!/usr/bin/env node
/**
 * Managed shell alias so plain `codex` runs through the ECC usage bar wrapper.
 *
 * Writes an idempotent, marker-delimited block into the user's shell rc files
 * (~/.zshrc, ~/.bashrc). The block is guarded at shell-eval time: it only
 * aliases when ECC_CODEX_ALIAS is not "off" and the wrapper file exists, so a
 * moved or uninstalled ECC degrades to plain `codex` instead of breaking.
 *
 * The wrapper's own internal `codex "$@"` call is unaffected — aliases do not
 * expand inside shell scripts, so there is no recursion.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeFileAtomic } = require('./atomic-write');

const BEGIN_MARKER = '# >>> ecc codex usage bar >>>';
const END_MARKER = '# <<< ecc codex usage bar <<<';

function defaultWrapperPath() {
  return path.resolve(__dirname, '..', 'codex', 'ecc-codex');
}

/**
 * An installed UTF-8 locale name, preferring portable ones. The bar's block
 * glyphs need a UTF-8 locale: without one tmux mangles them to underscores.
 * @returns {string} locale name, or '' when none is installed
 */
function detectUtf8Locale(dependencies = {}) {
  const run = dependencies.spawnSync || spawnSync;
  try {
    const result = run('locale', ['-a'], { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0) return '';
    const locales = String(result.stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
    const utf8 = locales.filter(l => /utf-?8$/i.test(l));
    const preferred = ['C.UTF-8', 'C.utf8', 'en_US.UTF-8', 'en_US.utf8'];
    for (const name of preferred) {
      const match = utf8.find(l => l.toLowerCase() === name.toLowerCase());
      if (match) return match;
    }
    return utf8[0] || '';
  } catch {
    return '';
  }
}

function aliasBlock(wrapperPath, utf8Locale = '') {
  const setupScript = path.resolve(path.dirname(wrapperPath), 'setup-codex-bar.js');
  const lines = [
    BEGIN_MARKER,
    '# Managed by ECC. Plain `codex` runs through the ECC usage bar wrapper.',
    '# Opt out: export ECC_CODEX_ALIAS=off  (or ECC_CODEX_BAR=off to keep the alias but hide the bar)',
    `# Remove:  node "${setupScript}" remove`,
  ];
  if (utf8Locale) {
    lines.push(
      '# The usage bar draws block glyphs, which need a UTF-8 locale.',
      'case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in',
      '  *[Uu][Tt][Ff]*) ;;',
      `  *) export LANG="${utf8Locale}" ;;`,
      'esac'
    );
  }
  lines.push(
    `if [ "\${ECC_CODEX_ALIAS:-on}" != "off" ] && [ -f "${wrapperPath}" ]; then`,
    `  alias codex='bash "${wrapperPath}"'`,
    'fi',
    END_MARKER
  );
  return lines.join('\n');
}

/** Remove any existing managed block (including its trailing newline). */
function stripBlock(content) {
  const begin = content.indexOf(BEGIN_MARKER);
  if (begin === -1) return content;
  const end = content.indexOf(END_MARKER, begin);
  if (end === -1) return content;
  let tail = content.slice(end + END_MARKER.length);
  if (tail.startsWith('\n')) tail = tail.slice(1);
  let head = content.slice(0, begin);
  if (head.endsWith('\n\n')) head = head.slice(0, -1);
  return head + tail;
}

function hasBlock(content) {
  return content.includes(BEGIN_MARKER) && content.includes(END_MARKER);
}

/**
 * A user-authored codex alias or function outside the managed block.
 * Appending our alias would silently override it (dropping flags like
 * `--yolo`), so install keeps the user's version instead.
 */
const FOREIGN_ALIAS_PATTERN = /^[ \t]*(alias[ \t]+codex[ \t=]|(function[ \t]+)?codex[ \t]*\(\))/m;

function hasForeignCodexAlias(content) {
  return FOREIGN_ALIAS_PATTERN.test(stripBlock(content));
}

/**
 * Shell rc files to manage: every existing candidate, or — when none exist —
 * the one matching $SHELL so fresh machines still get the alias.
 * @returns {string[]} absolute rc paths
 */
function resolveRcFiles(env, homeDir) {
  const candidates = [path.join(homeDir, '.zshrc'), path.join(homeDir, '.bashrc')];
  const files = candidates.filter(p => fs.existsSync(p));

  // The login shell's rc must always be covered: a zsh user whose home has
  // only a .bashrc would otherwise never see the alias.
  const shell = String(env.SHELL || '');
  const loginRc = shell.endsWith('/bash')
    ? path.join(homeDir, '.bashrc')
    : path.join(homeDir, '.zshrc');
  if (!files.includes(loginRc)) files.push(loginRc);

  return files;
}

/**
 * Install (or refresh) the managed alias block. Never throws.
 * @param {{env?: object, homeDir?: string, wrapperPath?: string}} options
 * @returns {{action: string, files?: Array<{path: string, action: string}>, reason?: string, error?: string}}
 */
function ensureCodexAliasDefault(options = {}) {
  if (process.platform === 'win32') {
    return { action: 'skipped', reason: 'unsupported-platform' };
  }
  try {
    const env = options.env || process.env;
    const homeDir = options.homeDir || env.HOME || os.homedir();
    const wrapperPath = options.wrapperPath || defaultWrapperPath();
    const utf8Locale = options.utf8Locale !== undefined
      ? options.utf8Locale
      : detectUtf8Locale();
    const rcFiles = resolveRcFiles(env, homeDir);

    // A user-authored codex alias in any managed rc wins everywhere: aliasing
    // from a second rc could silently shadow it depending on shell startup.
    const foreign = rcFiles.some(rcPath => (
      fs.existsSync(rcPath) && hasForeignCodexAlias(fs.readFileSync(rcPath, 'utf8'))
    ));
    if (foreign) {
      return {
        action: 'kept-existing',
        files: rcFiles.map(rcPath => ({ path: rcPath, action: 'kept-existing' })),
        wrapperPath,
      };
    }

    const files = rcFiles.map(rcPath => {
      const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';
      const alreadyManaged = hasBlock(existing);
      let base = stripBlock(existing);
      if (base.length > 0 && !base.endsWith('\n')) base += '\n';
      const separator = base.length > 0 ? '\n' : '';
      writeFileAtomic(rcPath, `${base}${separator}${aliasBlock(wrapperPath, utf8Locale)}\n`);
      return { path: rcPath, action: alreadyManaged ? 'updated' : 'configured' };
    });
    const configured = files.some(f => f.action !== 'kept-existing');
    return {
      action: configured ? 'configured' : 'kept-existing',
      files,
      wrapperPath,
      utf8Locale,
    };
  } catch (error) {
    return { action: 'skipped', error: error.message };
  }
}

/**
 * Remove the managed alias block from every rc file that has one. Never throws.
 */
function removeCodexAlias(options = {}) {
  try {
    const env = options.env || process.env;
    const homeDir = options.homeDir || env.HOME || os.homedir();
    const candidates = [path.join(homeDir, '.zshrc'), path.join(homeDir, '.bashrc')];
    const files = [];
    for (const rcPath of candidates) {
      if (!fs.existsSync(rcPath)) continue;
      const existing = fs.readFileSync(rcPath, 'utf8');
      if (!hasBlock(existing)) continue;
      writeFileAtomic(rcPath, stripBlock(existing));
      files.push({ path: rcPath, action: 'removed' });
    }
    return { action: files.length > 0 ? 'removed' : 'not-installed', files };
  } catch (error) {
    return { action: 'skipped', error: error.message };
  }
}

/**
 * Report which rc files currently carry the managed block.
 */
function aliasStatus(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || env.HOME || os.homedir();
  const candidates = [path.join(homeDir, '.zshrc'), path.join(homeDir, '.bashrc')];
  const files = candidates.map(rcPath => ({
    path: rcPath,
    exists: fs.existsSync(rcPath),
    installed: fs.existsSync(rcPath) && hasBlock(fs.readFileSync(rcPath, 'utf8')),
  }));
  return { installed: files.some(f => f.installed), files };
}

module.exports = {
  BEGIN_MARKER,
  END_MARKER,
  aliasBlock,
  detectUtf8Locale,
  stripBlock,
  hasForeignCodexAlias,
  resolveRcFiles,
  ensureCodexAliasDefault,
  removeCodexAlias,
  aliasStatus,
};
