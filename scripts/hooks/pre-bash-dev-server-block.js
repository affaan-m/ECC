#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024;
const { isDevServerCommand } = require('../lib/dev-command');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
  }
});

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const cmd = String(input.tool_input?.command || '');

    if (process.platform !== 'win32') {
      if (isDevServerCommand(cmd)) {
        console.error('[Hook] BLOCKED: Dev server must run in tmux for log access');
        console.error('[Hook] Use: tmux new-session -d -s dev "npm run dev"');
        console.error('[Hook] Then: tmux attach -t dev');
        process.exit(2);
      }
    }
  } catch {
    // ignore parse errors and pass through
  }

  process.stdout.write(raw);
});
