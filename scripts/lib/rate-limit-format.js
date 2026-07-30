/**
 * Rate-limit statusline formatting.
 *
 * LOCAL (thaint): on a Claude.ai subscription the dollar cost in the status
 * line is noise — nothing is billed per token, and the limit actually reached
 * is the rolling 5-hour window. Claude Code already hands that number to the
 * statusLine command on stdin as `rate_limits.five_hour`, so this renders it
 * instead. Kept out of ecc-statusline.js to stay inside the 200-line hook
 * budget in .claude/rules/node.md.
 */

'use strict';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Colour for a used-percentage, matching the tiers buildContextBar uses so a
 * reader learns one scale rather than two.
 * @param {number} used
 * @returns {string} ANSI opening sequence
 */
function severityColor(used) {
  if (used < 50) return '\x1b[32m';
  if (used < 65) return '\x1b[33m';
  if (used < 80) return '\x1b[38;5;208m';
  return '\x1b[1;31m';
}

/**
 * Time from now until a Unix epoch timestamp.
 *
 * `resets_at` is documented in **seconds**, while Date's numeric constructor
 * takes milliseconds — feeding it through unscaled lands in 1970, so the
 * scaling happens here and formatDuration in ecc-statusline.js (which takes an
 * ISO string) is deliberately not reused.
 *
 * @param {number} epochSeconds
 * @param {number} [nowMs] - injectable clock, for tests
 * @returns {string} e.g. "42s", "25m", "1h12m", "2h"; "" when unusable
 */
function formatCountdown(epochSeconds, nowMs) {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return '';

  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  // A reset in the past means a stale payload or a skewed clock. Clamp rather
  // than render "-14m", which reads as a bug to anyone who sees it.
  const seconds = Math.max(0, Math.floor((epochSeconds * 1000 - now) / 1000));

  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h${remMins}m` : `${hours}h`;
}

/**
 * Render the 5-hour rate-limit segment, e.g. "5h 24% ↻1h12m".
 *
 * Returns "" whenever the data is missing or unusable — `rate_limits` is only
 * present for Claude.ai subscribers, and only after the first API response —
 * which lets the caller fall back to a cost display instead.
 *
 * @param {object} rateLimits - the stdin `rate_limits` object
 * @param {number} [nowMs] - injectable clock, for tests
 * @returns {string} coloured segment, or ""
 */
function buildRateLimitSegment(rateLimits, nowMs) {
  const window = rateLimits && rateLimits.five_hour;
  if (!window) return '';

  const used = window.used_percentage;
  if (typeof used !== 'number' || !Number.isFinite(used)) return '';

  const pct = Math.round(used);
  let out = `${severityColor(used)}5h ${pct}%${RESET}`;

  // The countdown stays dim rather than severity-coloured: when the window is
  // nearly full, the time left is reassurance, not another alarm.
  const countdown = formatCountdown(window.resets_at, nowMs);
  if (countdown) out += ` ${DIM}↻${countdown}${RESET}`;

  return out;
}

module.exports = { formatCountdown, buildRateLimitSegment, severityColor };
