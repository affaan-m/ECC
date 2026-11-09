#!/usr/bin/env node
'use strict';

const { accumulate, check } = require('../lib/copilot-quality');
const { isHookEnabled } = require('../lib/hook-flags');
const MAX_BYTES = 1024 * 1024;

function run(event, raw, env = process.env, options = {}) {
  if (!['postToolUse', 'agentStop'].includes(event)) throw new Error('Unsupported quality event.');
  const id = event === 'postToolUse' ? 'post:edit:copilot-quality' : 'stop:copilot-quality';
  const hookEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLAUDE_PLUGIN_')));
  if (!isHookEnabled(id, { env: hookEnv, profiles: ['standard', 'strict'] })) return {};
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Quality input exceeds 1 MiB.');
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid quality payload.');
  const result = event === 'postToolUse' ? accumulate(payload, hookEnv) : check(payload, hookEnv);
  if (result.status !== 'checked') return {};
  const counts = result.checks.reduce((current, item) => ({ ...current,
    [item.status]: (current[item.status] || 0) + 1 }), {});
  const summary = `ECC quality (${result.mode}): ${result.files} observed edited file(s); ${Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(', ')}. Toolchain absence is not a passing check. Design/console findings require review.`;
  if (typeof options.report === 'function') {
    options.report(summary, Object.keys(counts).some(status => !['passed', 'deleted'].includes(status)));
  }
  return { additionalContext: summary };
}

if (require.main === module) {
  let raw = '';
  let bytes = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes <= MAX_BYTES) raw += chunk; });
  process.stdin.on('end', () => {
    try {
      if (bytes > MAX_BYTES) throw new Error('Quality input exceeds 1 MiB.');
      const result = run(process.argv[2], raw, process.env, { report(summary, attention) {
        // Native agentStop consumes decision/reason, not additionalContext.
        // Exit 2 surfaces a non-blocking warning to the user without forcing
        // an extra agent turn or falsely declaring an unavailable check passed.
        if (attention) { process.stderr.write(`${summary}\n`); process.exitCode = 2; }
      } });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      // Never echo project content, arguments, or subprocess output in errors.
      process.stderr.write('ECC quality check could not complete; result is unknown.\n');
      process.stdout.write('{}\n'); process.exitCode = 1;
    }
  });
  process.stdin.on('error', () => { process.exitCode = 1; });
}

module.exports = { run };
