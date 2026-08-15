#!/usr/bin/env node
/**
 * Skill router hook (UserPromptSubmit)
 *
 * Scores the submitted prompt against the skill catalog (offline token
 * matching via scripts/lib/skill-router.js) and, when skills clearly match,
 * emits a short routing note on stdout — which Claude Code injects as
 * context for the turn. Installed skills are suggested directly; skills
 * outside the active (slim) profile are suggested with their on-demand
 * SKILL.md path, so slim profile plugins keep the full catalog reachable.
 *
 * Exit code 0 always; empty stdout means "no routing opinion".
 */

'use strict';

const path = require('path');
const { routePrompt } = require('../lib/skill-router');

const MAX_STDIN = 1024 * 1024;
const MIN_PROMPT_LENGTH = 12;
const MAX_DESCRIPTION_CHARS = 120;

/**
 * Normalize a filesystem path to forward slashes for display.
 *
 * @param {string} anyPath Path in platform-native form.
 * @returns {string} Path with POSIX separators.
 */
function toPosix(anyPath) {
  return String(anyPath).split(path.sep).join('/');
}

/**
 * Flatten untrusted catalog text to a single safe line.
 *
 * Descriptions and ids reach this hook from SKILL.md frontmatter and from a
 * slim profile's ecc-profile.json catalog snapshot — plugin-supplied data
 * that lands directly in model context. A description carrying newlines,
 * carriage returns, or ANSI/C0 control bytes could otherwise forge extra
 * routing bullets or terminal escapes, so collapse all of it to spaces and
 * drop the control range entirely (Prompt Defense Baseline).
 *
 * @param {string} text Untrusted catalog text.
 * @returns {string} Single-line text with control characters removed.
 */
function sanitizeLine(text) {
  // eslint-disable-next-line no-control-regex
  return String(text || '').replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Render the routing note injected into the turn.
 *
 * @param {Array<object>} matches Scored matches from routePrompt().
 * @returns {string} Newline-terminated routing note.
 */
function buildMessage(matches) {
  const lines = ['[SkillRouter] Skills matching this prompt — use them if relevant:'];
  for (const match of matches) {
    const id = sanitizeLine(match.id);
    if (match.installed) {
      const description = sanitizeLine(match.description);
      const summary = description.length > MAX_DESCRIPTION_CHARS
        ? `${description.slice(0, MAX_DESCRIPTION_CHARS - 3)}...`
        : description;
      lines.push(`- ${id} (installed): ${summary}`);
    } else {
      lines.push(`- ${id} (on demand): definition at ${sanitizeLine(toPosix(match.sourceRoot))}/skills/${id}/SKILL.md`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Exportable run() for in-process execution via run-with-flags.js.
 * Always returns an explicit stdout key: for UserPromptSubmit, stdout is
 * injected as context, so the raw-input echo fallback must never trigger.
 */
function run(inputOrRaw, options = {}) {
  let input;
  try {
    input = typeof inputOrRaw === 'string'
      ? (inputOrRaw.trim() ? JSON.parse(inputOrRaw) : {})
      : (inputOrRaw || {});
  } catch {
    return { exitCode: 0, stdout: '' };
  }

  const prompt = String(input.prompt || '').trim();
  if (prompt.length < MIN_PROMPT_LENGTH || prompt.startsWith('/') || prompt.startsWith('!')) {
    return { exitCode: 0, stdout: '' };
  }

  const pluginRoot = options.pluginRoot
    || process.env.CLAUDE_PLUGIN_ROOT
    || path.resolve(__dirname, '..', '..');

  try {
    const matches = routePrompt(prompt, { pluginRoot });
    if (matches.length === 0) {
      return { exitCode: 0, stdout: '' };
    }
    return { exitCode: 0, stdout: buildMessage(matches) };
  } catch (error) {
    return { exitCode: 0, stdout: '', stderr: `[SkillRouter] ${error.message}` };
  }
}

/**
 * Stdin entrypoint for direct/spawnSync execution. Only runs when invoked
 * directly, never on require(), so stdin listeners are not leaked into a
 * parent that loads this hook in-process.
 */
function main() {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      data += chunk.substring(0, MAX_STDIN - data.length);
    }
  });
  process.stdin.on('end', () => {
    const result = run(data);
    if (result.stderr) {
      process.stderr.write(`${result.stderr}\n`);
    }
    process.stdout.write(result.stdout || '');
  });
}

module.exports = { run, main };

if (require.main === module) {
  main();
}
