#!/usr/bin/env node
const { readStdin, hookEnabled } = require('./adapter');
readStdin({ includeMetadata: true }).then(({ raw, truncated, readError }) => {
  if (!hookEnabled('pre:tab-read:sensitive-file-block', ['minimal', 'standard', 'strict'])) {
    process.stdout.write(raw);
    return;
  }
  if (truncated || readError) {
    console.error(truncated
      ? '[Cursor Hook] stdin exceeded the safety limit; blocking beforeTabFileRead'
      : '[Cursor Hook] stdin read failed; blocking beforeTabFileRead');
    process.exit(2);
  }
  try {
    const input = JSON.parse(raw);
    const filePath = [input.file_path, input.path, input.file]
      .find(value => typeof value === 'string' && value.trim()) || '';
    if (/\.(env|key|pem)$|\.env\.|credentials|secret/i.test(filePath)) {
      console.error('[ECC] BLOCKED: Tab cannot read sensitive file: ' + filePath);
      process.exit(2);
    }
  } catch {
    // Preserve the existing fail-open behavior for malformed Cursor payloads.
  }
  process.stdout.write(raw);
}).catch(() => process.exit(0));
