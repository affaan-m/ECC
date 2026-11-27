#!/usr/bin/env node
/**
 * Cursor sessionStart hook — inject ECC_AGENT_DATA_HOME for the composer session.
 *
 * Cursor passes session-scoped env from sessionStart output to all later hooks.
 * @see https://cursor.com/docs/hooks
 */

const {
  getCursorSessionEnvPayload,
  resolveAgentDataHome,
  AGENT_DATA_HOME_ENV,
} = require('../lib/agent-data-home');
const { readStdinJson, log } = require('../lib/utils');

function main() {
  readStdinJson()
    .then(() => {
      const envPayload = getCursorSessionEnvPayload({ preferCursorDefault: true });
      const agentDataHome = envPayload[AGENT_DATA_HOME_ENV];
      const payload = {
        env: envPayload,
        additional_context: [
          'ECC memory persistence uses a dedicated agent data root for this Cursor session.',
          `${AGENT_DATA_HOME_ENV}=${agentDataHome}`,
          'Session summaries, learned skills, aliases, and metrics live under that directory.',
          'Override via shell env, project .cursor/ecc-agent-data.json, or ECC docs (issue #2065).',
        ].join('\n'),
      };

      process.stdout.write(`${JSON.stringify(payload)}\n`);
      log(`[cursor-session-env] Set ${AGENT_DATA_HOME_ENV}=${agentDataHome}`);
      process.exit(0);
    })
    .catch(error => {
      const fallbackHome = resolveAgentDataHome({ preferCursorDefault: true });
      const payload = {
        env: { [AGENT_DATA_HOME_ENV]: fallbackHome },
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      log(`[cursor-session-env] Fallback ${AGENT_DATA_HOME_ENV}=${fallbackHome} (${error.message})`);
      process.exit(0);
    });
}

if (require.main === module) {
  main();
}

module.exports = { main };
