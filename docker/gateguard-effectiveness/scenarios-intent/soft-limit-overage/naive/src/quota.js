'use strict';

const plans = require('../config/plans.json');

/** The trap taken: a hard limit, which is what the config looks like. */
function checkQuota(usage, plan) {
  return { allowed: usage <= plans[plan].limit };
}

module.exports = { checkQuota };
