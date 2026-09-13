#!/usr/bin/env node
/**
 * Context Gate — UserPromptSubmit hook
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Deterministic end-of-session protocol. At >=90% context-window occupancy
 * (measured from the latest assistant `usage` record in the session
 * transcript, same signal as suggest-compact), injects a mandatory order:
 * bring the in-flight unit of work to its nearest clean stopping point,
 * write a structured checkpoint file (RESUME.md), hand the operator a
 * one-line resume command, and instruct closing the session. At >=96% the
 * order escalates to checkpoint-immediately, mid-task if necessary.
 *
 * Why an order instead of a suggestion (contrast with suggest-compact and
 * ecc-context-monitor, which advise and ask):
 * - Models pad the upper context range with unprompted "good stopping
 *   point" / "want to pause here?" narration on every turn. Each nudge is a
 *   decision pushed onto the operator mid-build, and the model already has
 *   the information the operator is being asked to evaluate.
 * - Advisory nudges repeat: once context is high, every turn re-raises the
 *   question. A gate fires once with a complete protocol instead.
 * - Compaction is lossy and automatic; a written checkpoint is curated and
 *   auditable. This hook is designed to pair with `autoCompactEnabled:
 *   false` (or a high `autoCompactWindow`) so the checkpoint always happens
 *   before any lossy summarization can — but it is safe with auto-compact
 *   left on (90% fires well before the default compaction point).
 *
 * The gate deliberately re-fires on every prompt while above threshold —
 * that is the enforcement, not a defect: the order stands until the session
 * is closed. Below threshold the hook is completely silent.
 *
 * Controls:
 * - ECC_CONTEXT_GATE_PCT       gate threshold percent (default 90; 0 disables)
 * - ECC_CONTEXT_GATE_EMERGENCY_PCT  escalation percent (default 96)
 * - ECC_CONTEXT_WINDOW_TOKENS / CLAUDE_CODE_AUTO_COMPACT_WINDOW  window
 *   override, honored by resolveContextWindow (transcript-context.js)
 * - Standard profile controls (ECC_HOOK_PROFILE, ECC_DISABLED_HOOKS) via
 *   run-with-flags.js
 */

'use strict';

const { readLatestContextTokens, resolveContextWindow, formatWindowLabel } = require('../lib/transcript-context');

const DEFAULT_GATE_PCT = 90;
const DEFAULT_EMERGENCY_PCT = 96;
const MIN_PCT = 1;
const MAX_PCT = 100;

/**
 * Resolve a percent setting from the environment.
 * `0` disables the gate entirely; invalid values fall back to the default.
 * @param {object} env
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function resolvePct(env, name, fallback) {
  const raw = env && env[name];
  if (raw !== undefined && raw !== null && raw !== '') {
    const parsed = Number.parseInt(raw, 10);
    if (parsed === 0) return 0;
    if (Number.isInteger(parsed) && parsed >= MIN_PCT && parsed <= MAX_PCT) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Build the checkpoint order injected as additionalContext.
 * @param {object} params
 * @param {number} params.pct - Occupancy percent (integer, floored).
 * @param {number} params.tokens - Context tokens observed.
 * @param {number} params.windowTokens - Resolved window size.
 * @param {boolean} params.inferred - Window size was assumed, not detected.
 * @param {boolean} params.emergency - Past the emergency threshold.
 * @returns {string}
 */
function buildOrderText({ pct, tokens, windowTokens, inferred, emergency }) {
  const windowLabel = formatWindowLabel(windowTokens);
  const lines = [
    `CONTEXT GATE TRIPPED (deterministic hook — this is an order, not a suggestion): context at ${pct}% ` +
      `(${tokens.toLocaleString('en-US')} tokens of a ${windowLabel} window${inferred ? ', window size inferred' : ''}).`,
    ''
  ];

  if (emergency) {
    lines.push(
      '*** EMERGENCY: past the escalation threshold. Skip step 1 below — write the checkpoint IMMEDIATELY, ' +
        'mid-task if necessary, recording exactly where work was interrupted. ***',
      ''
    );
  }

  lines.push(
    '1. Do NOT start any new work stream. Bring only the unit of work currently in flight to its nearest ' +
      'clean stopping point (finish the edit/test/verification underway; do not begin the next one).',
    '2. Write a checkpoint file: RESUME.md at the root of the active project directory (or under ' +
      '~/.claude/resume/ if no single project applies) containing: the objective; current state with ' +
      'VERIFIED facts strictly separated from hypotheses; decisions the operator approved; approaches ' +
      'ruled out and WHY; exact next steps; files touched; any pending or half-applied changes.',
    '3. Then state plainly that this session must now be closed, and give the operator this exact resume ' +
      'command on its own line:',
    '   claude "Read <absolute checkpoint path> and continue the work described there."',
    '4. Do NOT ask whether to stop, do NOT offer alternatives ("good stopping point", "want to pause?"), ' +
      'and do NOT take on further work in this session after the checkpoint is written. If the operator ' +
      'sends further prompts here, answer only from existing context and repeat the restart instruction.'
  );

  return lines.join('\n');
}

/**
 * @param {string} rawInput - Raw JSON string from stdin
 * @param {object} [env] - Environment (injectable for tests)
 * @returns {string} Hook JSON output when the gate fires; '' otherwise.
 */
function run(rawInput, env = process.env) {
  try {
    const gatePct = resolvePct(env, 'ECC_CONTEXT_GATE_PCT', DEFAULT_GATE_PCT);
    if (gatePct === 0) return '';
    const emergencyPct = resolvePct(env, 'ECC_CONTEXT_GATE_EMERGENCY_PCT', DEFAULT_EMERGENCY_PCT);

    const input = rawInput && rawInput.trim() ? JSON.parse(rawInput) : {};
    const latest = readLatestContextTokens(input.transcript_path);
    if (!latest) return '';

    const { windowTokens, inferred } = resolveContextWindow(latest.tokens, latest.model);
    const pct = Math.floor((latest.tokens / windowTokens) * 100);
    if (pct < gatePct) return '';

    const emergency = pct >= emergencyPct;
    const orderText = buildOrderText({
      pct,
      tokens: latest.tokens,
      windowTokens,
      inferred,
      emergency
    });

    return JSON.stringify({
      systemMessage:
        `[context-gate] ${pct}% of ${formatWindowLabel(windowTokens)} window used` +
        `${emergency ? ' (EMERGENCY)' : ''}. Claude has been ordered to reach a clean stopping point, ` +
        'write a checkpoint, and hand you a resume command for a fresh session.',
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: orderText
      }
    });
  } catch {
    // Fail open and silent: a broken gate must never block or pollute the
    // operator's prompt. UserPromptSubmit stdout is injected as context, so
    // '' (not a pass-through of rawInput) is the only safe failure output.
    return '';
  }
}

if (require.main === module) {
  let data = '';
  const MAX_STDIN = 1024 * 1024;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) data += chunk.substring(0, MAX_STDIN - data.length);
  });
  process.stdin.on('end', () => {
    process.stdout.write(run(data));
    process.exit(0);
  });
}

module.exports = { run, buildOrderText, resolvePct, DEFAULT_GATE_PCT, DEFAULT_EMERGENCY_PCT };
