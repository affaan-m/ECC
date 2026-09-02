#!/usr/bin/env node
/**
 * Skill router hook (UserPromptSubmit) - OPT-IN.
 *
 * Scores the submitted prompt against the skill catalog (offline token
 * matching via scripts/lib/skill-router.js) and, when skills clearly match,
 * emits a short routing note on stdout - which Claude Code injects as
 * context for the turn. Installed skills are suggested directly; skills a
 * generated carrier holds on demand are suggested with their path inside the
 * plugin.
 *
 * The router injects text into every matching turn, so it is off unless
 * explicitly enabled: ECC_SKILL_ROUTER=1 (or the plugin option
 * CLAUDE_PLUGIN_OPTION_SKILL_ROUTER=1). It is also bounded: if routing takes
 * longer than ECC_SKILL_ROUTER_BUDGET_MS (default 150), it emits nothing.
 *
 * Exit code 0 always; empty stdout means "no routing opinion".
 */

'use strict';

const path = require('path');
const { routePrompt } = require('../lib/skill-router');

const MAX_STDIN = 1024 * 1024;
const MIN_PROMPT_LENGTH = 12;
const MAX_DESCRIPTION_CHARS = 120;
const DEFAULT_BUDGET_MS = 150;

function isEnabled(env = process.env) {
  const raw = env.ECC_SKILL_ROUTER !== undefined ? env.ECC_SKILL_ROUTER : env.CLAUDE_PLUGIN_OPTION_SKILL_ROUTER;
  return ['1', 'true', 'yes', 'on'].includes(String(raw || '').trim().toLowerCase());
}

function budgetMs(env = process.env) {
  const raw = Number(env.ECC_SKILL_ROUTER_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_MS;
}

/**
 * Flatten untrusted catalog text to a single safe line: collapse newlines
 * and whitespace and drop C0/C1 control bytes so a description can never
 * forge extra routing bullets or terminal escapes.
 */
function sanitizeLine(text) {
  // eslint-disable-next-line no-control-regex
  return String(text || '').replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildMessage(matches) {
  const lines = ['[SkillRouter] Skills matching this prompt - use them if relevant:'];
  for (const match of matches) {
    const id = sanitizeLine(match.id);
    const description = sanitizeLine(match.description);
    const summary = description.length > MAX_DESCRIPTION_CHARS
      ? `${description.slice(0, MAX_DESCRIPTION_CHARS - 3)}...`
      : description;
    if (match.installed) {
      lines.push(`- ${id} (installed): ${summary}`);
    } else {
      lines.push(`- ${id} (on demand, read ${sanitizeLine(match.path)} inside this plugin): ${summary}`);
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
  const env = options.env || process.env;
  if (!isEnabled(env)) {
    return { exitCode: 0, stdout: '' };
  }

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
    || env.CLAUDE_PLUGIN_ROOT
    || path.resolve(__dirname, '..', '..');

  const startedAt = Date.now();
  try {
    const matches = routePrompt(prompt, { pluginRoot });
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > budgetMs(env)) {
      return { exitCode: 0, stdout: '', stderr: `[SkillRouter] routing took ${elapsedMs}ms, over the ${budgetMs(env)}ms budget; suppressed` };
    }
    if (matches.length === 0) {
      return { exitCode: 0, stdout: '' };
    }
    return { exitCode: 0, stdout: buildMessage(matches) };
  } catch (error) {
    return { exitCode: 0, stdout: '', stderr: `[SkillRouter] ${error.message}` };
  }
}

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

module.exports = { run, main, isEnabled };

if (require.main === module) {
  main();
}
