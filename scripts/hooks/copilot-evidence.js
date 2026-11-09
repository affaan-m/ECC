#!/usr/bin/env node
'use strict';
const { handleEvent } = require('../lib/copilot-evidence');
const { isHookEnabled } = require('../lib/hook-flags');
const MAX_BYTES = 1024 * 1024;
function run(event, raw, env = process.env) {
  if (env.ECC_COPILOT_FACTFORCE !== '1') return {};
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLAUDE_')));
  if (!isHookEnabled('copilot:read-evidence', { env: clean, profiles: ['standard', 'strict'] })) return {};
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Evidence input limit.');
  handleEvent(event, JSON.parse(raw), clean);
  return {};
}
if (require.main === module) {
  let raw = ''; let bytes = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes <= MAX_BYTES) raw += chunk; });
  process.stdin.on('end', () => {
    try {
      if (bytes > MAX_BYTES) throw new Error('Evidence input limit.');
      process.stdout.write(`${JSON.stringify(run(process.argv[2], raw))}\n`);
    } catch {
      // This bookkeeping hook never grants permission. The guard requires a
      // valid proof and denies an edit if capture failed or was unavailable.
      process.stderr.write('ECC read evidence unavailable; guarded edits still require valid evidence.\n');
      process.stdout.write('{}\n');
    }
  });
  process.stdin.on('error', () => { process.stderr.write('ECC read evidence input unavailable.\n'); });
}
module.exports = { run };
