/**
 * Claude Code hook protocol helpers, vendored with the same semantics as
 * `@deepseek-ai/dsh-hook-protocol`. Kept in its own module so the bundle entry
 * stays inside the repository's file-size limit; both files ship together in
 * `local-bundles/dsh-cc-hooks`.
 *
 * Pure functions only: matcher compilation, structured-output decoding, and
 * merging decoded outcomes. Nothing here touches the harness.
 */

/* ------------------------------------------------------------------ *
 * Claude Code hook protocol, vendored (semantics: dsh-hook-protocol)
 * ------------------------------------------------------------------ */

/** True for an absent / empty / `'*'` pattern — the match-all sentinels. */
export function isMatchAll(matcher) {
  return matcher === undefined || matcher === '' || matcher === '*';
}

/** A Claude-literal pattern is purely word characters plus `|`. */
export const CLAUDE_LITERAL = /^[A-Za-z0-9_|]+$/;

/** Patterns longer than this are treated as non-matches instead of compiled. */
export const MAX_MATCHER_LENGTH = 200;

/**
 * Compile an unanchored matcher regex; invalid patterns return `undefined`.
 * Matchers come from the user's own hooks.json and keep upstream's regex
 * semantics, but a length cap contains the ReDoS surface a non-literal
 * `RegExp` would otherwise expose (CWE-1333).
 */
export function compileRegex(pattern) {
  if (typeof pattern !== 'string' || pattern.length > MAX_MATCHER_LENGTH) return undefined;
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/** Whether `matcher` selects `query` under Claude Code dialect rules. */
export function matchesMatcher(matcher, query) {
  if (isMatchAll(matcher)) return true;
  if (CLAUDE_LITERAL.test(matcher)) return matcher.split('|').includes(query);
  return compileRegex(matcher)?.test(query) ?? false;
}

/** A plain (non-null, non-array) object, or `undefined`. */
export function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

export function stringField(object, key) {
  const value = object[key];
  return typeof value === 'string' ? value : undefined;
}

export function booleanField(object, key) {
  const value = object[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** The legacy top-level `decision` is only `approve`/`block`. */
export function topLevelDecisionOf(value) {
  return value === 'approve' || value === 'block' ? value : undefined;
}

/** `hookSpecificOutput.permissionDecision` is `allow`/`deny`/`ask` only. */
export function permissionDecisionOf(value) {
  return value === 'allow' || value === 'deny' || value === 'ask' ? value : undefined;
}

/**
 * Decode one hook process outcome. Exit 0 may carry structured JSON or plain
 * stdout; exit 2 blocks with stderr as the reason; any other exit is a
 * non-blocking error. `expectedEventName` gates the per-event
 * `hookSpecificOutput` block, so a hook answering for another event cannot
 * claim a decision here.
 */
export function parseHookOutput(exitCode, stdout, stderr, expectedEventName) {
  const trimmedErr = (stderr ?? '').trim();
  const trimmedOut = (stdout ?? '').trim();
  let output = { exitCode, stderr: trimmedErr, stdout: trimmedOut };
  if (exitCode === 2) {
    output = { ...output, decision: 'block', ...(trimmedErr.length > 0 ? { reason: trimmedErr } : {}) };
  }
  if (exitCode === 0 && trimmedOut.startsWith('{')) {
    let parsed;
    try {
      parsed = plainObject(JSON.parse(trimmedOut));
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined) output = applyStructured(output, parsed, expectedEventName);
  }
  return output;
}

/** Return a copy of `output` with the parsed structured-stdout fields applied. */
export function applyStructured(output, parsed, expectedEventName) {
  const next = { ...output };
  const cont = booleanField(parsed, 'continue');
  if (cont !== undefined) next.continue = cont;
  const stopReason = stringField(parsed, 'stopReason');
  if (stopReason !== undefined) next.stopReason = stopReason;
  const systemMessage = stringField(parsed, 'systemMessage');
  if (systemMessage !== undefined) next.systemMessage = systemMessage;
  const topDecision = topLevelDecisionOf(stringField(parsed, 'decision'));
  if (topDecision !== undefined) next.decision = topDecision;
  const topReason = stringField(parsed, 'reason');
  if (topReason !== undefined) next.reason = topReason;
  const hookSpecific = plainObject(parsed.hookSpecificOutput);
  if (hookSpecific === undefined) return next;
  const eventName = stringField(hookSpecific, 'hookEventName');
  if (eventName !== undefined) next.hookEventName = eventName;
  if (expectedEventName !== undefined && eventName !== expectedEventName) return next;
  const permission = permissionDecisionOf(stringField(hookSpecific, 'permissionDecision'));
  if (permission !== undefined) next.decision = permission;
  const permissionReason = stringField(hookSpecific, 'permissionDecisionReason');
  if (permissionReason !== undefined) next.reason = permissionReason;
  const additionalContext = stringField(hookSpecific, 'additionalContext');
  if (additionalContext !== undefined) next.additionalContext = additionalContext;
  const updatedInput = plainObject(hookSpecific.updatedInput);
  if (updatedInput !== undefined) next.updatedInput = updatedInput;
  return next;
}

export function rank(decision) {
  switch (decision) {
    case 'deny':
    case 'block':
      return 3;
    case 'ask':
      return 2;
    case 'approve':
    case 'allow':
      return 1;
    default:
      return 0;
  }
}

export function decisionForRank(maxRank) {
  switch (maxRank) {
    case 3:
      return 'deny';
    case 2:
      return 'ask';
    case 1:
      return 'allow';
    default:
      return 'none';
  }
}

/** Fold decoded outputs into one most-restrictive outcome (`deny > ask > allow`). */
export function mergeHookOutputs(outputs) {
  let maxRank = 0;
  const reasonsByRank = new Map();
  let stop = false;
  let stopReason;
  const additionalContext = [];
  const systemMessages = [];
  for (const output of outputs) {
    const outputRank = rank(output.decision);
    if (outputRank > maxRank) maxRank = outputRank;
    if ((outputRank === 3 || outputRank === 2) && typeof output.reason === 'string' && output.reason.length > 0) {
      const list = reasonsByRank.get(outputRank) ?? [];
      list.push(output.reason);
      reasonsByRank.set(outputRank, list);
    }
    if (output.continue === false && !stop) {
      stop = true;
      if (output.stopReason !== undefined) stopReason = output.stopReason;
    }
    if (typeof output.additionalContext === 'string' && output.additionalContext.length > 0) additionalContext.push(output.additionalContext);
    if (typeof output.systemMessage === 'string' && output.systemMessage.length > 0) systemMessages.push(output.systemMessage);
  }
  const reasons = reasonsByRank.get(maxRank) ?? [];
  return {
    decision: decisionForRank(maxRank),
    ...(reasons.length > 0 ? { reason: reasons.join('\n\n') } : {}),
    stop,
    ...(stopReason !== undefined ? { stopReason } : {}),
    additionalContext,
    systemMessages,
  };
}
