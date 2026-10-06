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

/** Env names already warned about this process — keeps the note one-time. */
const warnedEnvNames = new Set();

/**
 * Emit a one-time stderr note that an env override was present but rejected.
 * Deduped per env name so the gate re-firing on every prompt (and multiple
 * hooks resolving the same setting) cannot turn this into a spam stream.
 * Never throws — a logging failure must not change threshold resolution.
 * @param {string} name
 * @param {*} raw
 * @param {number} fallback
 */
function warnRejected(name, raw, fallback) {
  if (warnedEnvNames.has(name)) return;
  warnedEnvNames.add(name);
  try {
    process.stderr.write(
      `[context-gate] ignoring invalid ${name}="${raw}" ` +
      `(expected a whole integer 0-100); using default ${fallback}.\n`
    );
  } catch {
    /* stderr unavailable — resolution still returns the deterministic fallback */
  }
}

/**
 * Resolve a percent setting from the environment.
 * `0` disables the gate entirely; invalid values fall back to the default.
 * A whole decimal integer is required — parseInt-style partial parses
 * ('90abc' -> 90, '0x1' -> 0) would silently shift or disable the gate.
 * When an override is PRESENT but rejected (e.g. a typo'd '50.5' or '150'),
 * the return stays the deterministic fallback, but a one-time stderr note
 * surfaces the misconfiguration so a silently re-armed default gate — which
 * orders session restarts — does not go unnoticed.
 * @param {object} env
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function resolvePct(env, name, fallback) {
  const raw = env && env[name];
  if (raw !== undefined && raw !== null && raw !== '') {
    const str = String(raw).trim();
    // A whitespace-only value is treated as unset: silent fallback, no note.
    if (str === '') return fallback;
    if (/^(?:0|[1-9]\d*)$/.test(str)) {
      const parsed = Number(str);
      if (parsed === 0) return 0;
      if (Number.isInteger(parsed) && parsed >= MIN_PCT && parsed <= MAX_PCT) {
        return parsed;
      }
    }
    // Present but unparseable or out of range: deterministic fallback + one note.
    warnRejected(name, raw, fallback);
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
