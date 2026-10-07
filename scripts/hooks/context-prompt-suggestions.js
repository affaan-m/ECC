#!/usr/bin/env node
'use strict';

/**
 * UserPromptSubmit hook: suggest up to three skills from the managed profile's
 * routing index. Suggest-only; it loads no skill body, changes no selection,
 * and grants nothing. Opt in by setting ECC_CONTEXT_STATE_ROOT to the store
 * used with `ecc profile set`, and build the index with
 * `ecc profile routing-index --state-root <store>`.
 */

const path = require('node:path');

const MIN_PROMPT_LENGTH = 12;
const MAX_PROMPT_BYTES = 8192;
const DEFAULT_BUDGET_MS = 150;

function budgetMs(env) {
  const value = Number(env.ECC_CONTEXT_SUGGEST_BUDGET_MS);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 1000) : DEFAULT_BUDGET_MS;
}

function promptFrom(rawInput) {
  try {
    const input = JSON.parse(rawInput);
    return typeof input?.prompt === 'string' ? input.prompt : null;
  } catch {
    return null;
  }
}

function message(stateRoot, suggestions) {
  return ['ECC context suggestions (advisory; nothing was loaded):',
    ...suggestions.map(item => `- ${item.id}: ${item.description}`),
    `To load one, run ecc profile resolve --state-root ${JSON.stringify(stateRoot)} --task-input - --load with its ID in explicitIds or proposedIds.`,
    ''].join('\n');
}

function run(rawInput, _context = {}, env = process.env) {
  const started = Date.now();
  const stateRoot = env.ECC_CONTEXT_STATE_ROOT;
  if (!stateRoot || !path.isAbsolute(stateRoot) || path.resolve(stateRoot) !== stateRoot) return '';
  const prompt = promptFrom(rawInput);
  if (!prompt || prompt.trim().length < MIN_PROMPT_LENGTH || prompt.trimStart().startsWith('/')
    || Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) return '';
  const budget = budgetMs(env);
  try {
    const routing = require('../lib/context-routing-index');
    if (Date.now() - started >= budget) return '';
    const index = routing.readRoutingIndex(stateRoot);
    if (!index) {
      return { stdout: '', stderr: '[ContextSuggest] No routing index for the current profile; run ecc profile routing-index --state-root <store>.' };
    }
    if (index.selectionMode === 'manual' || Date.now() - started >= budget) return '';
    const suggestions = routing.suggestContext(index, prompt);
    if (!suggestions.length || Date.now() - started > budget) return '';
    return message(stateRoot, suggestions);
  } catch (error) {
    return { stdout: '', stderr: `[ContextSuggest] ${String(error.message).replace(/[^\x20-\x7E]/g, '?')}` };
  }
}

module.exports = { run };
