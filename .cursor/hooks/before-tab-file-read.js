#!/usr/bin/env node
const { readStdin, hookEnabled } = require('./adapter');
readStdin().then(raw => {
  if (!hookEnabled('pre:tab-read:sensitive-file-block', ['minimal', 'standard', 'strict'])) {
    process.stdout.write(raw);
    return;
  }
  try {
    const input = JSON.parse(raw);
    const filePath = input.path || input.file || '';
    if (/\.(env|key|pem)$|\.env\.|credentials|secret/i.test(filePath)) {
      console.error('[ECC] BLOCKED: Tab cannot read sensitive file: ' + filePath);
      process.exit(2);
    }
  } catch {
    // Preserve the existing fail-open behavior for malformed Cursor payloads.
  }
  process.stdout.write(raw);
}).catch(() => process.exit(0));
