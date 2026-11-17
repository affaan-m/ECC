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
 * deterministic protocol by setting ECC_CONTEXT_GATE_MODE=enforce. This is
 * prompt guidance; it does not block tools, reserve a path, or close the host session.
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
 * (<getSessionsDir()>/resume/<project>-<ownerDigest>-<sessionId>.md), NOT the project
 * root — so an operator's own RESUME.md is never a target and repeated fires
 * in one session overwrite only that session's own checkpoint. The resume
 * command is a proposed continuation instruction, never a durable handoff receipt.
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

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readLatestContextTokens, resolveContextWindow, formatWindowLabel } = require('../lib/transcript-context');
const { resolvePct, resolveGateMode, resolveGatePct, resolveEmergencyPct, DEFAULT_GATE_PCT, DEFAULT_EMERGENCY_PCT } = require('../lib/context-gate-state');
const { getSessionsDir, sanitizeSessionId } = require('../lib/utils');

/** Max disambiguation attempts before declining rather than guess a path. */
const MAX_CHECKPOINT_CANDIDATES = 50;

/**
 * Read-only proposal ownership, never a reservation or permission grant.
 * Symlinks and special files are occupied. Read errors decline this slot.
 */
function matchesOwner(candidate, observed, identity) {
  if (!observed.isFile() || observed.isSymbolicLink() || observed.nlink !== 1) return false;
  let fd;
  try {
    fd = fs.openSync(candidate, fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== observed.dev || opened.ino !== observed.ino) return false;
    const buf = Buffer.alloc(512);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const firstLine = buf.toString('utf8', 0, bytes).split(/\r?\n/, 1)[0];
    const marker = /^<!-- ecc-handoff owner=([a-f0-9]{64}) session=([A-Za-z0-9_-]+) project=([A-Za-z0-9_-]+) source-rev=(?:[a-f0-9]{40}|[a-f0-9]{64}|unknown) -->$/.exec(firstLine);
    return Boolean(marker && marker[1] === identity.ownerKey &&
      marker[2] === identity.sessionId && marker[3] === identity.project);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* read-only probe */ } }
  }
}

function safeDirectoryOrMissing(directory) {
  try {
    const st = fs.lstatSync(directory);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

function pickOwnedDestination(resumeDir, base, identity) {
  for (let i = 1; i <= MAX_CHECKPOINT_CANDIDATES; i++) {
    const candidate = path.join(resumeDir, i === 1 ? `${base}.md` : `${base}-${i}.md`);
    let observed;
    try { observed = fs.lstatSync(candidate); }
    catch (error) {
      if (error.code === 'ENOENT') return candidate;
      return null; // An unreadable destination is not a free slot.
    }
    if (matchesOwner(candidate, observed, identity)) return candidate;
  }
  return null;
}

/** Bind proposal identity to full project root and raw session, before filename sanitization. */
function resolveCheckpointIdentity(input, env) {
  const rawSession = [input && input.session_id, env && env.ECC_SESSION_ID, env && env.CLAUDE_SESSION_ID]
    .find(value => typeof value === 'string' && sanitizeSessionId(value));
  if (!rawSession) return null;
  const suppliedRoot = input && input.cwd;
  if (suppliedRoot !== undefined && (typeof suppliedRoot !== 'string' || !path.isAbsolute(suppliedRoot))) return null;
  let projectRoot = suppliedRoot || process.cwd();
  try { projectRoot = fs.realpathSync(projectRoot); }
  catch (error) { if (error.code !== 'ENOENT') return null; }
  const project = sanitizeSessionId(path.basename(projectRoot));
  const sessionId = sanitizeSessionId(rawSession);
  if (!project || !sessionId) return null;
  const ownerKey = crypto.createHash('sha256').update(JSON.stringify([projectRoot, rawSession])).digest('hex');
  const sessionsDir = getSessionsDir();
  const resumeDir = path.join(sessionsDir, 'resume');
  if (Array.from(resumeDir).some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127) ||
      !safeDirectoryOrMissing(sessionsDir) || !safeDirectoryOrMissing(resumeDir)) return null;
  const identity = { project: project.slice(0, 64), sessionId: sessionId.slice(0, 64), ownerKey };
  const base = `${identity.project}-${ownerKey.slice(0, 32)}-${identity.sessionId}`;
  const checkpointPath = pickOwnedDestination(resumeDir, base, identity);
  return checkpointPath ? { checkpointPath, ...identity } : null;
}

/** POSIX shells or PowerShell on Windows; the entire prompt is one literal argument. */
function resumeCommand(checkpointPath) {
  const prompt = `Read ${checkpointPath} and continue the work described there.`;
  const quoted = process.platform === 'win32'
    ? `'${prompt.replace(/['\u2018-\u201B]/g, '$&$&')}'`
    : `'${prompt.replace(/'/g, "'\\''")}'`;
  return `claude ${quoted}`;
}

/**
 * Build the checkpoint order injected as additionalContext (enforce mode).
 *
 * The hook only injects this order; it does not write or verify any file.
 * The checkpoint is therefore described as a PROPOSAL — the resume command is
 * valid only once the model has written the file and verified it exists and is
 * non-empty. The model is instructed to stamp an ownership marker (so a later
 * fire can recognize this session's own checkpoint; see matchesOwner) and
 * to record source revision metadata without claiming a content-bound receipt.
 * @param {object} params
 * @param {number} params.pct - Occupancy percent (integer, floored).
 * @param {number} params.tokens - Context tokens observed.
 * @param {number} params.windowTokens - Resolved window size.
 * @param {boolean} params.inferred - Window size was assumed, not detected.
 * @param {boolean} params.emergency - Past the emergency threshold.
 * @param {string} params.checkpointPath - Session-scoped checkpoint target.
 * @param {string} params.sessionId - Owner session id for the marker.
 * @param {string} params.project - Project segment for the marker.
 * @returns {string}
 */
function buildOrderText({ pct, tokens, windowTokens, inferred, emergency, checkpointPath, sessionId, project, ownerKey }) {
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
    '2. Write the PROPOSED checkpoint to EXACTLY this session-scoped path (create parent directories if ' +
      'needed). This path is a read-only proposal, not an atomic reservation. At write time reject ' +
      'symlinks or special files and recheck parent directories and the complete ownership marker. ' +
      'For a new file use exclusive creation; on any collision or failed verification preserve the ' +
      'existing file and report that the proposed checkpoint could not be saved:',
    `   ${checkpointPath}`,
    '   Make its FIRST line this exact ownership marker, replacing <GIT_HEAD> with the current source ' +
      'revision (run `git rev-parse HEAD`; use `unknown` if this is not a git repo) as source metadata. ' +
      'This marker does not verify content or create a durable receipt:',
    `   <!-- ecc-handoff owner=${ownerKey} session=${sessionId} project=${project} source-rev=<GIT_HEAD> -->`,
    '   After the marker it must contain: the objective; current state with VERIFIED facts strictly ' +
      'separated from hypotheses; decisions the operator approved; approaches ruled out and WHY; exact ' +
      'next steps; files touched; any pending or half-applied changes. Do NOT overwrite or modify an ' +
      'existing RESUME.md or any other file in the project — this path is dedicated to this session\'s ' +
      'handoff and preserves whatever the operator already has.',
    '3. After writing, VERIFY the checkpoint file exists and is non-empty. Until that verification ' +
      'succeeds the handoff is only a PROPOSAL — do NOT announce a completed handoff before it does.',
    '4. Only once the checkpoint is written and verified, state plainly that this session must now be ' +
      'closed and give the operator this exact resume command on its own line (valid only because the ' +
      'checkpoint above now exists):',
    `   ${resumeCommand(checkpointPath)}`,
    ...(process.platform === 'win32' ? ['   Run this command in PowerShell.'] : []),
    '5. Do NOT ask whether to stop, do NOT offer alternatives ("good stopping point", "want to pause?"), ' +
      'and do NOT take on further work in this session after the checkpoint is written. If the operator ' +
      'sends further prompts here, answer only from existing context and repeat the restart instruction.'
  );

  return lines.join('\n');
}

/**
 * Build the degraded-advisory text injected when enforce mode is on and the
 * gate has tripped, but no handoff identity could be established (no session
 * id), so no collision-safe checkpoint destination can be bound.
 *
 * This is NOT silent: the operator opted into enforce, so dropping all
 * guidance deep in the context band would hide exactly the warning they asked
 * for. Instead the gate declines the automatic checkpoint — it names NO path
 * and orders NO write — and tells the operator how to enable it.
 * @param {object} params
 * @param {number} params.pct
 * @param {number} params.tokens
 * @param {number} params.windowTokens
 * @param {boolean} params.inferred
 * @param {boolean} params.emergency
 * @returns {string}
 */
function buildDeclineText({ pct, tokens, windowTokens, inferred, emergency }) {
  const windowLabel = formatWindowLabel(windowTokens);
  const lines = [
    `CONTEXT GATE TRIPPED (enforce mode — operator opted in): context at ${pct}% ` +
      `(${tokens.toLocaleString('en-US')} tokens of a ${windowLabel} window${inferred ? ', inferred' : ''}).`,
    '',
    'Enforcement is on, but no safe project/session destination is available, so the gate cannot ' +
      'bind a collision-safe checkpoint destination and WILL NOT guess one. It is declining the automatic ' +
      'checkpoint rather than risk writing over another session\'s handoff.',
    ''
  ];
  if (emergency) {
    lines.push('*** EMERGENCY: past the escalation threshold — the context pressure is still real. ***', '');
  }
  lines.push(
    '1. Do NOT auto-write a checkpoint to any guessed, shared, or project-root path.',
    '2. Bring the unit of work currently in flight to its nearest clean stopping point; do not start new work.',
    '3. Check the current project, session identity (ECC_SESSION_ID where appropriate), and ownership of ' +
      'the configured handoff destination. If no safe destination is available, save a handoff explicitly ' +
      '(e.g. /save-session) and point the operator at the file they choose; the gate will not guess one.'
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

    // Enforcement requires a real handoff identity. When none can be
    // established, decline the automatic checkpoint (degraded advisory) rather
    // than bind a collision-prone shared path.
    const identity = resolveCheckpointIdentity(input, env);
    if (!identity) {
      return JSON.stringify({
        systemMessage:
          `[context-gate] ${pct}% of ${formatWindowLabel(windowTokens)} window used` +
          `${inferred ? ' (window size inferred)' : ''}${emergency ? ' (EMERGENCY)' : ''}. ` +
          'Enforce mode is on but the project/session identity or destination is unavailable, so no checkpoint destination can be ' +
          'safely bound. Check the project, ECC_SESSION_ID and destination ownership; Claude has been told to ' +
          'reach a clean stopping point and not to auto-write a handoff.',
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: buildDeclineText({ pct, tokens: latest.tokens, windowTokens, inferred, emergency })
        }
      });
    }

    const { checkpointPath, project, sessionId, ownerKey } = identity;
    const orderText = buildOrderText({
      pct,
      tokens: latest.tokens,
      windowTokens,
      inferred,
      emergency,
      checkpointPath,
      sessionId,
      project,
      ownerKey
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
