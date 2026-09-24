'use strict';

const { main } = require('../../scripts/install-guided');

function createPlan(request) {
  return {
    request,
    harnesses: request.harnesses.map(id => ({
      id,
      channel: id === 'kimi' ? 'managed-project' : 'native-plugin',
      preview: {},
    })),
  };
}

async function applyPlan(plan) {
  return {
    status: 'complete',
    completed: plan.harnesses.map(({ id }) => ({ id })),
    retryHarnesses: [],
  };
}

main([], {
  applyPlan,
  createPlan,
  showWelcome({ output }) {
    output.write('PTY_WELCOME_SHOWN\n');
  },
  startSpinner() {
    return { stop() {} };
  },
}).then(code => {
  process.exitCode = code;
});
