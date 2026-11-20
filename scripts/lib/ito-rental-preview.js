'use strict';

/**
 * Read-only, no-quote rental requirement normalizer for Itô compute handoff (#2791).
 * Never submits RFQs, holds inventory, or executes external network requests.
 */

const SAFE_TOKEN = /^[A-Za-z0-9._:/-]{1,80}$/;

function assertSafeToken(value, label) {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value.trim())) {
    throw new Error(`Invalid ${label}: rejected by fail-closed token validator`);
  }
  return value.trim();
}

function createRentalPreview(input = {}) {
  const accelerator = assertSafeToken(input.accelerator || 'H100', 'accelerator');
  const model = assertSafeToken(input.model || 'unspecified', 'model');
  const budgetUsd = input.maxBudgetUsd === undefined ? null : Number(input.maxBudgetUsd);
  if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd <= 0)) {
    throw new Error('Invalid maxBudgetUsd: expected positive finite number');
  }
  return {
    mode: 'read-only-preview',
    mutatesState: false,
    firmQuote: false,
    requirements: { accelerator, model, maxBudgetUsd: budgetUsd },
  };
}

module.exports = { createRentalPreview };
