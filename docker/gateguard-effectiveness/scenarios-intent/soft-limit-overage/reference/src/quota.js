'use strict';

const plans = require('../config/plans.json');

const FREE_CUTOFF = 1.1;

/** Soft limits: over is allowed and billed, except free past 110 percent. */
function checkQuota(usage, plan) {
  const limit = plans[plan].limit;
  const overage = Math.max(0, usage - limit);
  if (plan === 'free' && usage > limit * FREE_CUTOFF) return { allowed: false, overage };
  return { allowed: true, overage };
}

module.exports = { checkQuota };
