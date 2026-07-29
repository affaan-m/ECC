#!/usr/bin/env node
const { hookEnabled, readStdin, runExistingHook, transformToClaude } = require('./adapter');
readStdin().then(raw => {
  try {
    const input = JSON.parse(raw);
    const claudeInput = transformToClaude(input);
    const claudeStr = JSON.stringify(claudeInput);

    // Accumulate edited paths for batch format+typecheck at stop time
    runExistingHook('post-edit-accumulator.js', claudeStr);
    runExistingHook('post-edit-console-warn.js', claudeStr);
    if (hookEnabled('post:edit:design-quality-check', ['standard', 'strict'])) {
      runExistingHook('design-quality-check.js', claudeStr);
    }
  } catch {}
  process.stdout.write(raw);
}).catch(() => process.exit(0));
