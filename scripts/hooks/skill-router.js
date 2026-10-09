#!/usr/bin/env node
/**
 * Skill router hook (UserPromptSubmit) - OPT-IN, proposal-only.
 *
 * Ranks the submitted prompt against the canonical skill registry through
 * resolveTaskContext in `suggest` mode (scripts/lib/skill-router.js) and,
 * when skills match, emits a short suggestion note on stdout, which Claude
 * Code injects as context for the turn.
 *
 * This hook suggests; it does not select, load, or activate a skill, and it
 * changes no profile, capability grant, sandbox, or execution/evidence state.
 * Those stay with their current owners (see docs/SKILL-ROUTER.md).
 *
 * It injects text into every matching turn, so it is off unless explicitly
 * enabled: ECC_SKILL_ROUTER=1 (or CLAUDE_PLUGIN_OPTION_SKILL_ROUTER=1).
 *
 * The canonical resolver is synchronous and hashes the registry sources on
 * every call, so it runs in a child process killed at
 * ECC_SKILL_ROUTER_BUDGET_MS (default 2000). That timeout bounds how long
 * the prompt blocks, not only whether output is shown.
 *
 * Exit code 0 always; empty stdout means "no suggestion".
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const MAX_CHILD_OUTPUT = 64 * 1024;
const MIN_PROMPT_LENGTH = 12;
const MAX_DESCRIPTION_CHARS = 120;
const DEFAULT_BUDGET_MS = 2000;
const RESOLVE_FLAG = '--resolve';

/**
 * Whether the router is opted in for this process, via either the raw env
 * var or the plugin-option alias.
 *
 * @param {NodeJS.ProcessEnv} [env] Environment to read (defaults to `process.env`).
 * @returns {boolean} True when the router should run.
 */
function isEnabled(env = process.env) {
  const raw = env.ECC_SKILL_ROUTER !== undefined ? env.ECC_SKILL_ROUTER : env.CLAUDE_PLUGIN_OPTION_SKILL_ROUTER;
  return ['1', 'true', 'yes', 'on'].includes(String(raw || '').trim().toLowerCase());
}

/**
 * Resolve the routing time budget in milliseconds.
 *
 * @param {NodeJS.ProcessEnv} [env] Environment to read (defaults to `process.env`).
 * @returns {number} Budget in ms; falls back to `DEFAULT_BUDGET_MS` when unset or invalid.
 */
function budgetMs(env = process.env) {
  const raw = env.ECC_SKILL_ROUTER_BUDGET_MS;
  const value = Number(raw);
  // 0 is a valid budget ("never block the prompt"), distinct from an
  // unset/invalid value falling back to the default.
  return raw !== undefined && String(raw).trim() !== '' && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_BUDGET_MS;
}

/**
 * Flatten untrusted catalog text to a single safe line: collapse newlines
 * and whitespace and drop C0/C1 control bytes so a description can never
 * forge extra suggestion bullets or terminal escapes.
 */
function sanitizeLine(text) {
  // eslint-disable-next-line no-control-regex
  return String(text || '').replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Render the suggestions as the stdout block Claude Code injects as context.
 * Every field pulled from catalog data is sanitized first.
 *
 * @param {Array<{id: string, description: string}>} suggestions Ranked suggestions, in output order.
 * @returns {string} Newline-terminated suggestion message.
 */
function buildMessage(suggestions) {
  const lines = ['[SkillRouter] Skills that may fit this prompt (suggestions only; use them if relevant):'];
  for (const suggestion of suggestions) {
    const id = sanitizeLine(suggestion.id);
    const description = sanitizeLine(suggestion.description);
    const summary = description.length > MAX_DESCRIPTION_CHARS
      ? `${description.slice(0, MAX_DESCRIPTION_CHARS - 3)}...`
      : description;
    lines.push(`- ${id}: ${summary}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Run the canonical resolver in a child process killed at the budget.
 *
 * @param {object} request Serializable resolver request.
 * @param {number} budget Budget in ms.
 * @param {string} resolverPath Script to run with RESOLVE_FLAG.
 * @returns {{suggestions?: Array<object>, stderr?: string}} Suggestions, or a reason to stay silent.
 */
function resolveWithinBudget(request, budget, resolverPath) {
  if (budget <= 0) {
    return { stderr: '[SkillRouter] budget is 0ms; suppressed' };
  }
  const child = spawnSync(process.execPath, [resolverPath, RESOLVE_FLAG], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: budget,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_CHILD_OUTPUT,
    windowsHide: true,
  });
  if (child.error && child.error.code === 'ETIMEDOUT') {
    return { stderr: `[SkillRouter] resolution exceeded the ${budget}ms budget; suppressed` };
  }
  if (child.error || child.status !== 0) {
    const detail = child.error ? child.error.message : sanitizeLine(child.stderr) || `exit ${child.status}`;
    return { stderr: `[SkillRouter] ${detail}` };
  }
  try {
    const parsed = JSON.parse(child.stdout);
    return { suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [] };
  } catch {
    return { stderr: '[SkillRouter] resolver returned malformed output; suppressed' };
  }
}

/**
 * Exportable run() for in-process execution via run-with-flags.js.
 * Always returns an explicit stdout key: for UserPromptSubmit, stdout is
 * injected as context.
 *
 * @param {string|object} inputOrRaw Hook payload, raw or parsed.
 * @param {object} [options] Options; `env`, `pluginRoot`, and `resolverPath` exist for tests.
 * @returns {{exitCode: number, stdout: string, stderr?: string}} Hook result.
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

  const request = {
    prompt,
    sessionId: input.session_id,
    profileId: env.ECC_SKILL_ROUTER_PROFILE || undefined,
    repoRoot: options.pluginRoot || env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..'),
  };
  const result = resolveWithinBudget(request, budgetMs(env), options.resolverPath || __filename);
  if (!result.suggestions) {
    return { exitCode: 0, stdout: '', stderr: result.stderr };
  }
  if (result.suggestions.length === 0) {
    return { exitCode: 0, stdout: '' };
  }
  return { exitCode: 0, stdout: buildMessage(result.suggestions) };
}

/**
 * Read all of stdin, bounded at MAX_STDIN, then hand it to `done`.
 *
 * @param {(data: string) => void} done Callback with the bounded input.
 * @returns {void}
 */
function readStdin(done) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      data += chunk.substring(0, MAX_STDIN - data.length);
    }
  });
  process.stdin.on('end', () => done(data));
}

/**
 * Child-process entrypoint: resolve one request read from stdin and write
 * `{ suggestions }` JSON to stdout. A resolver error exits 1 with the
 * message on stderr, so the parent stays silent and fails closed.
 *
 * @returns {void}
 */
function resolveMain() {
  readStdin(data => {
    try {
      const request = JSON.parse(data);
      const { suggestSkills } = require('../lib/skill-router');
      const { suggestions } = suggestSkills(request.prompt, {
        repoRoot: request.repoRoot,
        profileId: request.profileId,
        sessionId: request.sessionId,
      });
      process.stdout.write(JSON.stringify({ suggestions }));
    } catch (error) {
      process.stderr.write(String(error && error.message ? error.message : error));
      process.exitCode = 1;
    }
  });
}

/**
 * CLI entrypoint: read the hook's JSON payload from stdin, route it, and
 * write stdout/stderr exactly as `run()` returns them.
 *
 * @returns {void}
 */
function main() {
  readStdin(data => {
    const result = run(data);
    if (result.stderr) {
      process.stderr.write(`${result.stderr}\n`);
    }
    process.stdout.write(result.stdout || '');
  });
}

module.exports = { run, main, isEnabled, budgetMs, buildMessage, DEFAULT_BUDGET_MS };

if (require.main === module) {
  if (process.argv[2] === RESOLVE_FLAG) {
    resolveMain();
  } else {
    main();
  }
}
