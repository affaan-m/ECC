#!/usr/bin/env node
const { readStdin, runExistingHook, transformToClaude, hookEnabled } = require('./adapter');
readStdin().then(raw => {
  try {
    const claudeInput = JSON.parse(raw || '{}');
    if (hookEnabled('pre:compact', ['standard', 'strict'])) {
      runExistingHook('pre-compact.js', transformToClaude(claudeInput));
    }
  } catch {
    // PreCompact is advisory; malformed payloads fail open.
  }
  process.stdout.write(raw);
}).catch(() => process.exit(0));
