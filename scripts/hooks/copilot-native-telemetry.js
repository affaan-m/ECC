#!/usr/bin/env node
'use strict';
const { importNativeSkillFacts } = require('../lib/copilot-native-skill-telemetry');
const { isHookEnabled } = require('../lib/hook-flags');
const MAX_BYTES = 1024 * 1024;
function run(event, raw, env = process.env) {
  if (!['agentStop', 'sessionEnd'].includes(event)) throw new Error('Unsupported native telemetry event.');
  if (env.ECC_COPILOT_TELEMETRY !== '1') return {};
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLAUDE_')));
  if (!isHookEnabled('copilot:native-skill-telemetry', { env: clean, profiles: ['standard', 'strict'] })) return {};
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Native telemetry input limit.');
  importNativeSkillFacts(JSON.parse(raw), clean);
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
      process.stderr.write('ECC native telemetry unavailable; no skill outcome or permission inferred.\n');
      process.stdout.write('{}\n');
    }
  });
  process.stdin.on('error', () => { process.stderr.write('ECC native telemetry input unavailable.\n'); });
}
module.exports = { run };
