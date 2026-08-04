'use strict';

/**
 * Shared cost estimation for ECC hooks.
 *
 * Approximate per-1M-token blended rates (conservative defaults).
 */

const RATE_TABLE = {
  haiku: { in: 0.8, out: 4.0 },
  sonnet: { in: 3.0, out: 15.0 },
  opus: { in: 15.0, out: 75.0 }
};

/**
 * Estimate USD cost from token counts.
 * @param {string} model - Model name (may contain "haiku", "sonnet", or "opus")
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} Estimated cost in USD (rounded to 6 decimal places)
 */
function estimateCost(model, inputTokens, outputTokens) {
  const normalized = String(model || '').toLowerCase();
  let rates = RATE_TABLE.sonnet;
  if (normalized.includes('haiku')) rates = RATE_TABLE.haiku;
  if (normalized.includes('opus')) rates = RATE_TABLE.opus;

  const cost = (inputTokens / 1_000_000) * rates.in + (outputTokens / 1_000_000) * rates.out;
  return Math.round(cost * 1e6) / 1e6;
}

module.exports = { estimateCost, RATE_TABLE };
