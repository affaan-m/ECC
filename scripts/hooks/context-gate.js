#!/usr/bin/env node
/**
 * Context Gate — UserPromptSubmit hook
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Enforcement is OPT-IN. On a default install the gate runs in `advisory`
 * mode: it returns immediately, does no per-prompt transcript work, and
 * suppresses nothing — the advisory hooks (suggest-compact,
 * ecc-context-monitor) keep their normal behavior. The operator turns on the
 * deterministic protocol by setting ECC_CONTEXT_GATE_MODE=enforce.
 *
 * In enforce mode: at >=90% context-window occupancy (measured from the
 * latest assistant `usage` record in the session transcript, same signal as
 * suggest-compact), the hook injects an order: bring the in-flight unit of
 * work to its nearest clean stopping point, write a structured checkpoint
 * file, hand the operator a one-line resume command, and instruct closing
 * the session. At >=96% the order escalates to checkpoint-immediately,
 * mid-task if necessary.
 *
 * The checkpoint is written to a collision-safe, identity-bearing path under
 * the plugin's session-handoff directory
 * (<getSessionsDir()>/resume/<project>-<sessionId>.md) — NOT the project
 * root — so an operator's own RESUME.md is never a target and repeated fires
 * in one session overwrite only that session's own checkpoint. The resume
 * command naming that exact path is the handoff receipt.
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
 * Precedence over the advisory hooks: in enforce mode only, once occupancy
 * reaches the gate threshold, suggest-compact and ecc-context-monitor
 * suppress their /compact suggestions and context warnings (via isGateActive
 * / isGateEnabled in lib/context-gate-state.js) so the model never receives
 * contradictory instructions in the gate band. In advisory mode isGateEnabled
 * is false, so there is no suppression and the advisory hooks are unaffected.
 *
 * The gate deliberately re-fires on every prompt while above threshold —
 * that is the enforcement, not a defect: the order stands until the session
 * is closed. Below threshold the hook is completely silent.
 *
 * Controls:
 * - ECC_CONTEXT_GATE_MODE      advisory (default; inert) | enforce (opt in to
 *   the order + advisory-hook deference) | off (same as PCT=0)
 * - ECC_CONTEXT_GATE_PCT       gate threshold percent (default 90; 0 disables)
 * - ECC_CONTEXT_GATE_EMERGENCY_PCT  escalation percent (default 96; always
 *   clamped to at least gate+1 so the two-tier order is preserved)
 * - ECC_CONTEXT_WINDOW_TOKENS / CLAUDE_CODE_AUTO_COMPACT_WINDOW  window
 *   override, honored by resolveContextWindow (transcript-context.js)
 * - Standard profile controls (ECC_HOOK_PROFILE, ECC_DISABLED_HOOKS) via
 *   run-with-flags.js
 */

'use strict';

const path = require('path');
const { readLatestContextTokens, resolveContextWindow, formatWindowLabel } = require('../lib/transcript-context');
const { resolvePct, resolveGateMode, resolveGatePct, resolveEmergencyPct, DEFAULT_GATE_PCT, DEFAULT_EMERGENCY_PCT } = require('../lib/context-gate-state');
const { getSessionsDir, getProjectName, sanitizeSessionId } = require('../lib/utils');

/**
 * Compute a collision-safe, identity-bearing checkpoint path under the
 * plugin's session-handoff directory. Never the project root, so an
 * operator's own RESUME.md is never a target; the session id in the name
 * keeps repeated fires in one session pointed at the same file (idempotent
 * — the model overwrites only its own checkpoint, never a user file).
 * @param {object} input - Parsed hook stdin ({ cwd, session_id }).
 * @returns {string} Absolute path to the session-scoped checkpoint file.
 */
function resolveCheckpointPath(input) {
  const resumeDir = path.join(getSessionsDir(), 'resume');
  const project =
    sanitizeSessionId(input && input.cwd ? path.basename(String(input.cwd)) : null) ||
    sanitizeSessionId(getProjectName()) ||
    'project';
  const sessionId =
    sanitizeSessionId(input && input.session_id) ||
    sanitizeSessionId(process.env.ECC_SESSION_ID) ||
    sanitizeSessionId(process.env.CLAUDE_SESSION_ID) ||
    'session';
  return path.join(resumeDir, `${project}-${sessionId}.md`);
}

/**
 * Build the checkpoint order injected as additionalContext (enforce mode).
 * @param {object} params
 * @param {number} params.pct - Occupancy percent (integer, floored).
 * @param {number} params.tokens - Context tokens observed.
 * @param {number} params.windowTokens - Resolved window size.
 * @param {boolean} params.inferred - Window size was assumed, not detected.
 * @param {boolean} params.emergency - Past the emergency threshold.
 * @param {string} params.checkpointPath - Session-scoped checkpoint target.
 * @returns {string}
 */
function buildOrderText({ pct, tokens, windowTokens, inferred, emergency, checkpointPath }) {
  const windowLabel = formatWindowLabel(windowTokens);
  // An inferred window means the true denominator may be larger (an
  // unrecognized 1M-window model would read as 90% at 180k of an assumed
  // 200k window). The protocol still fires — an unknown true-200k model at
  // 90% is the exact case the gate exists for — but as a strong
  // recommendation rather than an order, so a possibly-wrong denominator
  // never forces a restart.
  const lines = [
    inferred
      ? `CONTEXT GATE TRIPPED (enforce mode — operator opted in): context at ~${pct}% of an INFERRED ` +
        `${windowLabel} window (${tokens.toLocaleString('en-US')} tokens; the true window may be larger — ` +
        'set ECC_CONTEXT_WINDOW_TOKENS to correct it). Treat the following as a strong recommendation:'
      : `CONTEXT GATE TRIPPED (enforce mode — operator opted in; this is an order, not a suggestion): ` +
        `context at ${pct}% (${tokens.toLocaleString('en-US')} tokens of a ${windowLabel} window).`,
    '',
    // Occupancy is a measurement, not by itself authority to abandon the task.
    // The authority here is the operator's explicit opt-in to enforce mode.
    'The occupancy figure above is an observed measurement, not by itself permission to abandon the task. ' +
      'The authority to checkpoint-and-hand-off now comes from the operator having enabled enforce mode.',
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
    '2. Write the checkpoint to EXACTLY this session-scoped path (create parent directories if needed):',
    `   ${checkpointPath}`,
    '   It must contain: the objective; current state with VERIFIED facts strictly separated from ' +
      'hypotheses; decisions the operator approved; approaches ruled out and WHY; exact next steps; files ' +
      'touched; any pending or half-applied changes. Do NOT overwrite or modify an existing RESUME.md or ' +
      'any other file in the project — this path is dedicated to this session\'s handoff and preserves ' +
      'whatever the operator already has.',
    '3. Then state plainly that this session must now be closed, and give the operator this exact resume ' +
      'command on its own line (the receipt for this handoff):',
    `   claude "Read ${checkpointPath} and continue the work described there."`,
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
    // Enforcement is opt-in. In the default advisory mode the gate is inert:
    // return before any transcript work so a default install adds zero
    // per-prompt cost and leaves the advisory hooks unsuppressed.
    if (resolveGateMode(env) !== 'enforce') return '';
    const gatePct = resolveGatePct(env);
    if (gatePct === 0) return '';
    // Emergency must sit in a strictly tighter band than the gate. Otherwise a
    // gate threshold at or above the emergency default (e.g.
    // ECC_CONTEXT_GATE_PCT=98 against the 96 default) makes every fire count as
    // "emergency" and permanently skips step 1 — bringing in-flight work to a
    // clean stopping point. Clamp so the two-tier order is always preserved.
    const emergencyPct = Math.max(resolveEmergencyPct(env), gatePct + 1);

    const input = rawInput && rawInput.trim() ? JSON.parse(rawInput) : {};
    const latest = readLatestContextTokens(input.transcript_path);
    if (!latest) return '';

    const { windowTokens, inferred } = resolveContextWindow(latest.tokens, latest.model, env);
    const pct = Math.floor((latest.tokens / windowTokens) * 100);
    if (pct < gatePct) return '';

    const emergency = pct >= emergencyPct;
    const checkpointPath = resolveCheckpointPath(input);
    const orderText = buildOrderText({
      pct,
      tokens: latest.tokens,
      windowTokens,
      inferred,
      emergency,
      checkpointPath
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
