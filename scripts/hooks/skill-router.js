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

function toPosix(anyPath) {
  return String(anyPath).split(path.sep).join('/');
}

function buildMessage(matches) {
  const lines = ['[SkillRouter] Skills matching this prompt — use them if relevant:'];
  for (const match of matches) {
    if (match.installed) {
      const summary = match.description.length > MAX_DESCRIPTION_CHARS
        ? `${match.description.slice(0, MAX_DESCRIPTION_CHARS - 3)}...`
        : match.description;
      lines.push(`- ${match.id} (installed): ${summary}`);
    } else {
      lines.push(`- ${match.id} (on demand): definition at ${toPosix(match.sourceRoot)}/skills/${match.id}/SKILL.md`);
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
