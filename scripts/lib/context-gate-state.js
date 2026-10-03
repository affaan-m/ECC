/**
 * Context-gate state — shared threshold resolution and activity check.
 *
 * Single source of truth for the context-gate thresholds so the advisory
 * hooks (suggest-compact, ecc-context-monitor) can defer to the gate
 * instead of emitting contradictory guidance in the same context band.
 * The gate orders a checkpoint-and-restart; the advisory hooks suggest
 * /compact or "ask the user" — both must go silent once the gate owns
 * the turn.
 */

'use strict';

const { isHookEnabled } = require('./hook-flags');
const { readLatestContextTokens, resolveContextWindow } = require('./transcript-context');

const DEFAULT_GATE_PCT = 90;
const DEFAULT_EMERGENCY_PCT = 96;
const MIN_PCT = 1;
const MAX_PCT = 100;

/** Hook id and profiles exactly as registered in hooks/hooks.json. */
const GATE_HOOK_ID = 'user-prompt:context-gate';
const GATE_HOOK_PROFILES = 'standard,strict';

/**
 * Resolve a percent setting from the environment.
 * `0` disables the gate entirely; invalid values fall back to the default.
 * A whole decimal integer is required — parseInt-style partial parses
 * ('90abc' -> 90, '0x1' -> 0) would silently shift or disable the gate.
 * @param {object} env
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function resolvePct(env, name, fallback) {
  const raw = env && env[name];
  if (raw !== undefined && raw !== null && raw !== '') {
    if (!/^(?:0|[1-9]\d*)$/.test(String(raw).trim())) return fallback;
    const parsed = Number(String(raw).trim());
    if (parsed === 0) return 0;
    if (Number.isInteger(parsed) && parsed >= MIN_PCT && parsed <= MAX_PCT) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Gate threshold percent for the given environment (0 = gate disabled).
 * @param {object} [env]
 * @returns {number}
 */
function resolveGatePct(env = process.env) {
  return resolvePct(env, 'ECC_CONTEXT_GATE_PCT', DEFAULT_GATE_PCT);
}

/**
 * Emergency escalation percent for the given environment.
 * @param {object} [env]
 * @returns {number}
 */
function resolveEmergencyPct(env = process.env) {
  return resolvePct(env, 'ECC_CONTEXT_GATE_EMERGENCY_PCT', DEFAULT_EMERGENCY_PCT);
}

/**
 * True when the context-gate hook is installed-and-enabled for this
 * environment (profile allows it, not in ECC_DISABLED_HOOKS, threshold
 * not set to 0). Says nothing about current occupancy.
 * @param {object} [env]
 * @returns {boolean}
 */
function isGateEnabled(env = process.env) {
  if (resolveGatePct(env) === 0) return false;
  return isHookEnabled(GATE_HOOK_ID, { profiles: GATE_HOOK_PROFILES, env });
}

/**
 * True when the gate is enabled AND the observed occupancy has reached
 * its threshold — i.e. the gate is issuing (or about to issue) the
 * checkpoint order and advisory hooks must stay silent.
 * @param {object} params
 * @param {number} params.tokens - Observed context tokens.
 * @param {number} params.windowTokens - Resolved window size.
 * @param {object} [params.env]
 * @returns {boolean}
 */
function isGateActive({ tokens, windowTokens, env = process.env }) {
  if (!Number.isFinite(tokens) || !Number.isFinite(windowTokens) || windowTokens <= 0) {
    return false;
  }
  if (!isGateEnabled(env)) return false;
  const pct = Math.floor((tokens / windowTokens) * 100);
  return pct >= resolveGatePct(env);
}

/**
 * True when the gate is CONFIRMED active for the given session transcript:
 * gate enabled, transcript readable, usage resolved, and occupancy at/above
 * the threshold. Returns false whenever the gate cannot evaluate usage
 * (missing/unreadable transcript, no usage record) — callers use this to
 * decide whether to defer to the gate, and a gate that cannot fire must
 * never silence its fallbacks. Never throws.
 * @param {string} transcriptPath
 * @param {object} [env]
 * @returns {boolean}
 */
function gateOwnsTranscript(transcriptPath, env = process.env) {
  try {
    const usage = readLatestContextTokens(transcriptPath);
    if (!usage) return false;
    const { windowTokens } = resolveContextWindow(usage.tokens, usage.model, env);
    return isGateActive({ tokens: usage.tokens, windowTokens, env });
  } catch {
    return false;
  }
}

module.exports = {
  resolvePct,
  gateOwnsTranscript,
  resolveGatePct,
  resolveEmergencyPct,
  isGateEnabled,
  isGateActive,
  DEFAULT_GATE_PCT,
  DEFAULT_EMERGENCY_PCT,
  GATE_HOOK_ID,
  GATE_HOOK_PROFILES
};
