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
 *   auditable. This hook REQUIRES pairing with `autoCompactEnabled: false`
 *   (or a raised `autoCompactWindow`) to be reachable: with auto-compact
 *   left on, compaction triggers around ~83.5% occupancy (the last ~16.5%
 *   of the window is the auto-compact buffer — see AUTO_COMPACT_BUFFER_PCT
 *   in ecc-statusline.js), which is before the 90% gate threshold, so the
 *   gate would never fire. With auto-compact on the hook is harmless but
 *   inert.
 *
 * Precedence over the advisory hooks: once occupancy reaches the gate
 * threshold, suggest-compact and ecc-context-monitor suppress their
 * /compact suggestions and context warnings (via isGateActive /
 * isGateEnabled in lib/context-gate-state.js) so the model never receives
 * contradictory instructions in the gate band.
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
const { resolvePct, resolveGatePct, resolveEmergencyPct, DEFAULT_GATE_PCT, DEFAULT_EMERGENCY_PCT } = require('../lib/context-gate-state');

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
  // An inferred window means the true denominator may be larger (an
  // unrecognized 1M-window model would read as 90% at 180k of an assumed
  // 200k window). The protocol still fires — an unknown true-200k model at
  // 90% is the exact case the gate exists for — but as a strong
  // recommendation rather than an order, so a possibly-wrong denominator
  // never forces a restart.
  const lines = [
    inferred
      ? `CONTEXT GATE TRIPPED (deterministic hook): context at ~${pct}% of an INFERRED ${windowLabel} window ` +
        `(${tokens.toLocaleString('en-US')} tokens; the true window may be larger — set ` +
        'ECC_CONTEXT_WINDOW_TOKENS to correct it). Treat the following as a strong recommendation:'
      : `CONTEXT GATE TRIPPED (deterministic hook — this is an order, not a suggestion): context at ${pct}% ` +
        `(${tokens.toLocaleString('en-US')} tokens of a ${windowLabel} window).`,
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
 * @param {object} [options] - Runner metadata from run-with-flags.js
 *   ({ hookId, pluginRoot, ... }); tests may inject `options.env` to
 *   override the process environment. Environment controls are always
 *   read from `options.env || process.env` — never from the metadata
 *   object itself.
 * @returns {string} Hook JSON output when the gate fires; '' otherwise.
 */
function run(rawInput, options = {}) {
  try {
    const env = (options && options.env) || process.env;
    const gatePct = resolveGatePct(env);
    if (gatePct === 0) return '';
    const emergencyPct = resolveEmergencyPct(env);

    const input = rawInput && rawInput.trim() ? JSON.parse(rawInput) : {};
    const latest = readLatestContextTokens(input.transcript_path);
    if (!latest) return '';

    const { windowTokens, inferred } = resolveContextWindow(latest.tokens, latest.model, env);
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
        `${inferred ? ' (window size inferred)' : ''}${emergency ? ' (EMERGENCY)' : ''}. ` +
        `Claude has been ${inferred ? 'strongly advised' : 'ordered'} to reach a clean stopping point, ` +
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
