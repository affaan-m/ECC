#!/usr/bin/env node
'use strict';
const { observe } = require('../lib/copilot-observations');
const { parseEventEnvelope } = require('../lib/copilot-event-envelope');
const { isHookEnabled } = require('../lib/hook-flags');
const MAX_BYTES = 1024 * 1024;
function run(event, raw, env = process.env) {
  if (!['preToolUse', 'postToolUse', 'postToolUseFailure'].includes(event)) throw new Error('Unsupported observation event.');
  if (env.ECC_COPILOT_OBSERVE !== '1') return {};
  const hookEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLAUDE_PLUGIN_')));
  if (!isHookEnabled('copilot:observe', { env: hookEnv, profiles: ['standard', 'strict'] })) return {};
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Observation input limit.');
  observe(parseEventEnvelope(event, JSON.parse(raw)), hookEnv);
  return {};
}
if (require.main === module) {
  let raw = ''; let bytes = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes <= MAX_BYTES) raw += chunk; });
  process.stdin.on('end', () => {
    try {
      if (bytes > MAX_BYTES) throw new Error('Input limit.');
      process.stdout.write(`${JSON.stringify(run(process.argv[2], raw))}\n`);
    } catch {
      // Optional metadata collection never grants a tool permission or repeats it.
      process.stderr.write('ECC observation unavailable; no tool outcome inferred.\n');
      process.stdout.write('{}\n');
    }
  });
  process.stdin.on('error', () => { process.stderr.write('ECC observation input unavailable.\n'); });
}
module.exports = { run };
