#!/usr/bin/env node
/**
 * One-time setup questions introduced by an ECC version.
 *
 * A fresh install answers these in the guided wizard, but people who already
 * run ECC would otherwise never see a question added later. Both
 * `ecc install --guided` and `ecc auto-update` ask whatever is still pending,
 * and answers are recorded so nobody is asked twice.
 *
 * To add a question: append an entry to PROMPTS with a stable `id`, an
 * `applies()` guard narrow enough that irrelevant users never see it, and an
 * `apply()` that performs the change.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');

function answersPath(env = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude');
  return path.join(configDir, 'ecc', 'setup-answers.json');
}

/** Recorded answers keyed by prompt id, or {} when never answered. */
function loadAnswers(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(answersPath(env), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Record one answer. Never throws — a read-only home must not fail an install. */
function recordAnswer(id, answer, env = process.env) {
  try {
    const target = answersPath(env);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const answers = { ...loadAnswers(env), [id]: answer };
    writeFileAtomic(target, `${JSON.stringify(answers, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

function localeIsUtf8(env = process.env) {
  return /utf-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '');
}

const PROMPTS = [
  {
    id: 'codex-utf8',
    optionKey: 'codexUtf8',
    question: 'Your shell locale is not UTF-8, so the Codex usage bar cannot draw its\n'
      + 'block characters. Set a UTF-8 locale in your shell config?',
    choices: ['yes', 'no'],
    defaultChoice: 'yes',
    /**
     * Only for people who actually use the Codex bar on a non-UTF-8 shell, and
     * only when a UTF-8 locale exists to switch to.
     */
    applies(context = {}) {
      const env = context.env || process.env;
      if (localeIsUtf8(env)) return false;
      const codexInUse = context.codexSelected
        || require('./codex-shell-alias').aliasStatus({ env }).installed;
      if (!codexInUse) return false;
      return Boolean(require('./codex-shell-alias').detectUtf8Locale());
    },
    apply(answer, context = {}) {
      const { ensureCodexAliasDefault } = require('./codex-shell-alias');
      return ensureCodexAliasDefault({
        env: context.env || process.env,
        ...(answer === 'yes' ? {} : { utf8Locale: '' }),
      });
    },
  },
];

/**
 * Questions this user has not answered yet and that apply to their setup.
 * @param {{env?: object, codexSelected?: boolean}} context
 * @returns {Array<object>}
 */
function pendingPrompts(context = {}) {
  const env = context.env || process.env;
  const answers = loadAnswers(env);
  return PROMPTS.filter(prompt => (
    answers[prompt.id] === undefined && prompt.applies({ ...context, env })
  ));
}

module.exports = {
  PROMPTS,
  answersPath,
  loadAnswers,
  recordAnswer,
  pendingPrompts,
};
