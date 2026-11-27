#!/usr/bin/env node
const { hookEnabled, readStdin, runExistingHook, transformToClaude } = require('./adapter');
readStdin().then(raw => {
  try {
    const input = JSON.parse(raw);
    const claudeInput = transformToClaude(input, {
      tool_input: { file_path: input.file_path || input.path || input.file || '' }
    });
    const claudeStr = JSON.stringify(claudeInput);

    // Accumulate edited paths for batch format+typecheck at stop time.
    if (hookEnabled('post:edit:accumulator', ['standard', 'strict'])) {
      runExistingHook('post-edit-accumulator.js', claudeStr);
    }
    if (hookEnabled('post:edit:console-warn', ['standard', 'strict'])) {
      runExistingHook('post-edit-console-warn.js', claudeStr, { forwardStderr: true });
    }
    if (hookEnabled('post:edit:design-quality-check', ['standard', 'strict'])) {
      runExistingHook('design-quality-check.js', claudeStr, { forwardStderr: true });
    }
  } catch {
    // Cursor post-event hooks fail open on malformed or partial payloads.
  }
  process.stdout.write(raw);
}).catch(() => process.exit(0));
