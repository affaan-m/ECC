/**
 * Transcript context-size helpers for the strategic-compact hook (#2155).
 *
 * Reads the latest assistant `usage` record from a Claude Code session
 * transcript (JSONL) and derives a context-size signal:
 *
 * - `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
 *   partition the prompt, so their sum is the true context size of the turn.
 * - The context window is detected from the model id: the `[1m]` marker, the
 *   known-family table, then family patterns (`opus-4` is 400k, `sonnet-4` /
 *   `haiku` / `claude-3` are 200k). An id that matches nothing yields `null`
 *   (unknown) rather than a guess, so no percentage is ever fabricated.
 * - Thresholds are a percentage of the detected window (70%) and
 *   env-overridable; re-reminders fire in token "buckets" above the threshold
 *   so the suggestion only repeats after real context growth.
 *
 * Only the tail of the transcript is read (latest records live at the end),
 * keeping the PreToolUse hook fast even for very large sessions.
 */

const fs = require('fs');

const STANDARD_CONTEXT_WINDOW_TOKENS = 200000;
const EXTENDED_CONTEXT_WINDOW_TOKENS = 400000;
const LARGE_CONTEXT_WINDOW_TOKENS = 1000000;
// Legacy absolute defaults, kept exported for compatibility with anything that
// imported them; the live default is now a percentage of the detected window.
const DEFAULT_CONTEXT_THRESHOLD_STANDARD = 160000;
const DEFAULT_CONTEXT_THRESHOLD_LARGE = 250000;
// One rule that holds at every window size: 140k on 200k, 280k on 400k, 700k on
// 1M. The old absolute 250k default meant a 1M-window session was nagged from
// 25% usage onward, re-firing every interval for the rest of a long session.
const DEFAULT_CONTEXT_THRESHOLD_PCT = 0.7;
// Used when the window is unknown: past every standard window, so the nudge is
// still truthful without inventing a percentage.
const UNKNOWN_WINDOW_THRESHOLD_TOKENS = 300000;
const DEFAULT_CONTEXT_INTERVAL_TOKENS = 60000;
const CONTEXT_INTERVAL_PCT = 0.05;
const DEFAULT_TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const MAX_TOKEN_SETTING = 10000000;
const LARGE_WINDOW_MODEL_MARKER = '[1m]';

// Known large-window model families whose ids carry no `[1m]` marker (#2461).
// Matched boundary-aware against the model id — covers dated/region-prefixed
// variants (e.g. `us.anthropic.claude-fable-5-20260115-v1:0`) without matching
// hypothetical smaller tiers sharing the prefix (e.g. `claude-fable-5-mini`).
// Checked in order, first match wins. Best-effort and expected to lag new
// releases; the env override remains the escape hatch for unlisted models.
const KNOWN_MODEL_WINDOW_TOKENS = [
  ['claude-fable-5', LARGE_CONTEXT_WINDOW_TOKENS],
  ['claude-mythos-5', LARGE_CONTEXT_WINDOW_TOKENS]
];

// Family patterns applied after the exact table above. These cover whole model
// generations rather than single ids, so `opus-4` no longer needs the
// env-only workaround from #2290 (Opus 4.x is a 400k window, which matches
// neither the 200k default nor the `[1m]` marker). Checked in order.
const MODEL_WINDOW_PATTERNS = [
  [/opus-4/i, EXTENDED_CONTEXT_WINDOW_TOKENS],
  [/sonnet-4|haiku|claude-3|opus-3/i, STANDARD_CONTEXT_WINDOW_TOKENS]
];

/**
 * True when `model` contains `familyId` ending at a token boundary: end of id,
 * a delimiter (`[`, `:`, `.`), or a dated/versioned suffix (`-20260115`).
 * Alphanumeric continuations and letter suffixes (`-mini`) are different
 * models, possibly with smaller windows, and must not match.
 */
function isKnownModelFamilyMatch(model, familyId) {
  const start = model.indexOf(familyId);
  if (start === -1) {
    return false;
  }
  const rest = model.slice(start + familyId.length);
  return !/^[A-Za-z0-9]/.test(rest) && !/^-[A-Za-z]/.test(rest);
}

/**
 * Read the trailing `tailBytes` of a file as UTF-8.
 * Returns null when the file is missing or unreadable.
 */
function readFileTail(filePath, tailBytes) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return null;
  }

  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - tailBytes);
    const length = size - start;
    if (length <= 0) {
      return { text: '', truncated: false };
    }

    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, start);
    return {
      text: buffer.toString('utf8', 0, bytesRead),
      truncated: start > 0
    };
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Extract the context token total from a transcript record's usage block.
 * Returns 0 when the record carries no usable usage data.
 */
function extractUsageTokens(record) {
  const usage = record && record.message && record.message.usage;
  if (!usage || typeof usage !== 'object') {
    return 0;
  }

  const total =
    (Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0) +
    (Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0) +
    (Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : 0);

  return total > 0 ? total : 0;
}

/**
 * Scan a session transcript (JSONL) backwards for the most recent record with
 * a non-empty `message.usage` block.
 *
 * @param {string} transcriptPath - Absolute path to the transcript JSONL.
 * @param {object} [options]
 * @param {number} [options.tailBytes] - How many trailing bytes to scan.
 * @returns {{ tokens: number, model: string } | null} Latest context size, or
 *   null when the transcript is missing, unreadable, or has no usage records.
 */
function readLatestContextTokens(transcriptPath, options = {}) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) {
    return null;
  }

  const tailBytes = Number.isInteger(options.tailBytes) && options.tailBytes > 0 ? options.tailBytes : DEFAULT_TRANSCRIPT_TAIL_BYTES;

  const tail = readFileTail(transcriptPath, tailBytes);
  if (!tail) {
    return null;
  }

  const lines = tail.text.split('\n');
  // The first line of a truncated tail is almost certainly partial JSON.
  const firstLine = tail.truncated ? 1 : 0;

  for (let i = lines.length - 1; i >= firstLine; i--) {
    const line = lines[i].trim();
    if (!line) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const tokens = extractUsageTokens(record);
    if (tokens > 0) {
      const model = record.message && typeof record.message.model === 'string' ? record.message.model : '';
      return { tokens, model };
    }
  }

  return null;
}

/**
 * Detect the context window size for a turn, in resolution order:
 *   1. `ECC_CONTEXT_WINDOW_TOKENS` / `CLAUDE_CODE_AUTO_COMPACT_WINDOW` override;
 *   2. the `[1m]` marker on the model id;
 *   3. the known large-window family table (#2461);
 *   4. family patterns (`opus-4` 400k, `sonnet-4`/`haiku`/`claude-3` 200k);
 *   5. no model id at all: 200k, unless the observed token count already
 *      exceeds it — then the window is provably larger but its size is unknown.
 *
 * @returns {number|null} Window size in tokens, or null when the window cannot
 *   be determined. Callers must treat null as "unknown" and must not derive a
 *   percentage from it — a wrong window is worse than no number, because it is
 *   indistinguishable from a real one.
 */
function resolveContextWindowTokens(tokens, model) {
  // Explicit window override wins: 400k models (e.g. Opus 4.x) match neither the
  // 200k default nor the 1M marker and would otherwise report ~double usage (#2290).
  // Honor ECC's own knob and Claude Code's native CLAUDE_CODE_AUTO_COMPACT_WINDOW.
  const env = (typeof process !== 'undefined' && process.env) || {};
  const envWindow = Number.parseInt(env.ECC_CONTEXT_WINDOW_TOKENS || env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || '', 10);
  if (Number.isInteger(envWindow) && envWindow > 0) {
    return envWindow;
  }

  if (typeof model === 'string' && model.includes(LARGE_WINDOW_MODEL_MARKER)) {
    return LARGE_CONTEXT_WINDOW_TOKENS;
  }

  // Large-window model families without a [1m] marker fall through the checks
  // above and would be misreported against the 200k default (#2461).
  if (typeof model === 'string' && model) {
    const known = KNOWN_MODEL_WINDOW_TOKENS.find(([familyId]) => isKnownModelFamilyMatch(model, familyId));
    if (known) {
      return known[1];
    }

    const pattern = MODEL_WINDOW_PATTERNS.find(([regex]) => regex.test(model));
    if (pattern) {
      return pattern[1];
    }

    // A model id we do not recognize. Guessing "over 200k therefore 1M" was
    // wrong for every 400k model and invented percentages for the rest.
    return null;
  }

  // No model id in the transcript. Above the standard window the context is
  // provably larger than 200k, but nothing says how much larger.
  if (Number.isFinite(tokens) && tokens > STANDARD_CONTEXT_WINDOW_TOKENS) {
    return null;
  }

  return STANDARD_CONTEXT_WINDOW_TOKENS;
}

/**
 * Resolve the context-size suggestion threshold (tokens).
 * Defaults to `DEFAULT_CONTEXT_THRESHOLD_PCT` of the detected window (140k on
 * 200k, 280k on 400k, 700k on 1M), so the signal means the same thing on every
 * model. `COMPACT_CONTEXT_THRESHOLD` still sets an absolute token count and
 * `COMPACT_CONTEXT_THRESHOLD=0` still disables the context signal entirely;
 * other invalid values fall back to the percentage default.
 *
 * @param {object} env - Environment map.
 * @param {number|null} windowTokens - Detected window, or null when unknown.
 */
function resolveContextThreshold(env, windowTokens) {
  const raw = env && env.COMPACT_CONTEXT_THRESHOLD;
  if (raw !== undefined && raw !== null && raw !== '') {
    const parsed = Number.parseInt(raw, 10);
    if (parsed === 0) {
      return 0;
    }
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_TOKEN_SETTING) {
      return parsed;
    }
  }

  if (!Number.isFinite(windowTokens) || windowTokens <= 0) {
    return UNKNOWN_WINDOW_THRESHOLD_TOKENS;
  }

  return Math.round(windowTokens * DEFAULT_CONTEXT_THRESHOLD_PCT);
}

/**
 * Resolve the re-reminder step (tokens of additional context growth before the
 * suggestion repeats). Scales with the window when one is known
 * (`CONTEXT_INTERVAL_PCT`, floored at the 60k default) so a bigger window does
 * not mean proportionally more reminders. Invalid values fall back to the
 * default.
 *
 * @param {object} env - Environment map.
 * @param {number|null} [windowTokens] - Detected window, or null when unknown.
 */
function resolveContextInterval(env, windowTokens) {
  const raw = env && env.COMPACT_CONTEXT_INTERVAL;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_TOKEN_SETTING) {
    return parsed;
  }

  if (Number.isFinite(windowTokens) && windowTokens > 0) {
    return Math.max(DEFAULT_CONTEXT_INTERVAL_TOKENS, Math.round(windowTokens * CONTEXT_INTERVAL_PCT));
  }

  return DEFAULT_CONTEXT_INTERVAL_TOKENS;
}

/**
 * Map a context size onto a suggestion bucket.
 * Returns -1 below the threshold; bucket 0 at the threshold; +1 for every
 * `interval` tokens of growth beyond it. The hook fires only when the bucket
 * rises above the last bucket it already fired for.
 */
function computeContextBucket(tokens, threshold, interval) {
  if (!Number.isFinite(tokens) || threshold <= 0 || tokens < threshold) {
    return -1;
  }

  const step = Number.isInteger(interval) && interval > 0 ? interval : DEFAULT_CONTEXT_INTERVAL_TOKENS;
  return Math.floor((tokens - threshold) / step);
}

/**
 * Human-readable label for a context window size (e.g. "200k", "400k", "1M",
 * "1.5M"). Returns "unknown" when the window could not be determined.
 */
function formatWindowLabel(windowTokens) {
  if (!Number.isFinite(windowTokens) || windowTokens <= 0) {
    return 'unknown';
  }

  if (windowTokens >= LARGE_CONTEXT_WINDOW_TOKENS) {
    const millions = windowTokens / LARGE_CONTEXT_WINDOW_TOKENS;
    return `${Number.isInteger(millions) ? millions : Number(millions.toFixed(1))}M`;
  }

  return `${Math.round(windowTokens / 1000)}k`;
}

module.exports = {
  STANDARD_CONTEXT_WINDOW_TOKENS,
  EXTENDED_CONTEXT_WINDOW_TOKENS,
  LARGE_CONTEXT_WINDOW_TOKENS,
  DEFAULT_CONTEXT_THRESHOLD_STANDARD,
  DEFAULT_CONTEXT_THRESHOLD_LARGE,
  DEFAULT_CONTEXT_THRESHOLD_PCT,
  UNKNOWN_WINDOW_THRESHOLD_TOKENS,
  DEFAULT_CONTEXT_INTERVAL_TOKENS,
  DEFAULT_TRANSCRIPT_TAIL_BYTES,
  readLatestContextTokens,
  resolveContextWindowTokens,
  resolveContextThreshold,
  resolveContextInterval,
  computeContextBucket,
  formatWindowLabel
};
