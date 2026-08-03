'use strict';

/**
 * Shared cost estimation for ECC hooks.
 *
 * Approximate per-1M-token blended rates (conservative defaults).
 */

const RATE_TABLE = {
  haiku: { in: 0.8, out: 4.0 },
  sonnet: { in: 3.0, out: 15.0 },
  opus: { in: 5.0, out: 25.0 },
  fable: { in: 10.0, out: 50.0 }
};

/**
 * Estimate USD cost from token counts.
 * @param {string} model - Model name (may contain "haiku", "sonnet", "opus", or "fable")
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number|null} Estimated cost in USD (rounded to 6 decimal places), or null if the model is not recognized
 */
function estimateCost(model, inputTokens, outputTokens) {
  const normalized = String(model || '').toLowerCase();
  let rates = null;
  if (normalized.includes('haiku')) rates = RATE_TABLE.haiku;
  else if (normalized.includes('sonnet')) rates = RATE_TABLE.sonnet;
  else if (normalized.includes('opus')) rates = RATE_TABLE.opus;
  else if (normalized.includes('fable')) rates = RATE_TABLE.fable;

  if (!rates) return null;

  const cost = (inputTokens / 1_000_000) * rates.in + (outputTokens / 1_000_000) * rates.out;
  return Math.round(cost * 1e6) / 1e6;
}

module.exports = { estimateCost, RATE_TABLE };
