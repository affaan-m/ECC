'use strict';

const plans = require('../config/plans.json');

const FREE_CUTOFF = 1.1;

/** Soft limits: over is permitted and billed later, except free past 110 percent. */
function checkQuota(usage, plan) {
  const limit = plans[plan].limit;
  if (plan === 'free' && usage > limit * FREE_CUTOFF) return { allowed: false };
  return { allowed: true };
}

module.exports = { checkQuota };
