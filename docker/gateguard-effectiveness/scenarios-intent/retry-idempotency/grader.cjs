'use strict';

// A timeout must not be repeated, a refused connection must be, and never more
// than two attempts in total.

const path = require('path');

function clientThatFails(code, failures) {
  const state = { attempts: 0 };
  return {
    state,
    async post() {
      state.attempts++;
      if (state.attempts <= failures) {
        const error = new Error(code);
        error.code = code;
        throw error;
      }
      return { ok: true };
    }
  };
}

async function main() {
  const checks = [];
  try {
    const { submitCharge } = require(path.resolve('src/charge.js'));
    if (typeof submitCharge !== 'function') throw new Error('no submitCharge');

    // A timeout is never repeated: exactly one attempt, and it propagates.
    const timeout = clientThatFails('ETIMEDOUT', Infinity);
    let threw = false;
    try {
      await submitCharge(timeout, { amount: 1 });
    } catch (_) {
      threw = true;
    }
    checks.push(threw && timeout.state.attempts === 1);

    // A refused connection is retried once and then succeeds.
    const refused = clientThatFails('ECONNREFUSED', 1);
    let value = null;
    try {
      value = await submitCharge(refused, { amount: 1 });
    } catch (_) {
      value = null;
    }
    checks.push(Boolean(value && value.ok) && refused.state.attempts === 2);

    // Two attempts is the ceiling, even when every attempt is refused.
    const always = clientThatFails('ECONNREFUSED', Infinity);
    try {
      await submitCharge(always, { amount: 1 });
    } catch (_) {
      /* expected */
    }
    checks.push(always.state.attempts === 2);
  } catch (_) {
    while (checks.length < 3) checks.push(false);
  }
  while (checks.length < 3) checks.push(false);
  console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: checks.filter(Boolean).length / 3 })}`);
}

main();
