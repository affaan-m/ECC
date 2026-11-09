#!/usr/bin/env node
'use strict';

const fs = require('fs');
const sessions = require('../lib/copilot-sessions');
const { isHookEnabled } = require('../lib/hook-flags');
const MAX_INPUT_BYTES = 1024 * 1024;

async function readInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes <= MAX_INPUT_BYTES) chunks.push(chunk);
  }
  if (bytes > MAX_INPUT_BYTES) throw new Error('Copilot lifecycle input exceeds 1 MiB.');
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  const automatic = sessions.EVENTS.includes(action);
  if (automatic) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CLAUDE_')));
    if (!isHookEnabled(`copilot:${action}`, { env, profiles: ['standard', 'strict'] })) return {};
    if (args.length) throw new Error('Unexpected lifecycle arguments.');
    const payload = JSON.parse(await readInput());
    const result = sessions.processLifecycle(action, payload, env);
    if (action === 'agentStop') {
      try {
        const notification = require('../lib/copilot-accessories').notifyLifecycle(action, payload, env);
        if (['failed', 'unavailable', 'timeout'].includes(notification.status)) {
          process.stderr.write('ECC desktop notification unavailable; work continues.\n');
        }
      } catch { process.stderr.write('ECC desktop notification skipped; work continues.\n'); }
    }
    return result;
  }
  const workspace = fs.realpathSync(process.cwd());
  if (action === 'list' && !args.length) {
    return { workspace, sessions: sessions.listSessions(workspace).map(record => ({
      sessionId: record.sessionId, updatedAt: record.updatedAt, status: record.status, hasSummary: Boolean(record.summary),
    })) };
  }
  if (action === 'recall' && (!args.length || (args.length === 2 && args[0] === '--session'))) {
    const record = sessions.recall(workspace, args[1]);
    return { workspace, session: record?.sessionId || null, summary: record?.summary || '',
      ...(record?.summary ? { additionalContext: sessions.historicalContext(record) } : {}) };
  }
  if (action === 'checkpoint' && args.length === 3 && args[0] === '--session' && args[2] === '--stdin') {
    const record = sessions.checkpoint(workspace, args[1], await readInput());
    return { saved: true, sessionId: record.sessionId, updatedAt: record.updatedAt };
  }
  throw new Error('Usage: copilot-lifecycle.js checkpoint --session <id> --stdin | recall [--session <id>] | list');
}

main().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(() => {
  // Never echo prompts, transcript data, checkpoint bodies or filesystem paths.
  process.stderr.write('ECC Copilot lifecycle failed: invalid, unavailable, busy or unsafe session data. Inspect the configured session store and documented limits.\n');
  process.stdout.write('{}\n');
  process.exitCode = 1;
});
