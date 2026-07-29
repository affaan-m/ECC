#!/usr/bin/env node
const { getCursorFilePath, readStdin } = require('./adapter');
readStdin().then(raw => {
  try {
    const input = JSON.parse(raw || '{}');
    const filePath = getCursorFilePath(input);
    if (/\.(env|key|pem)$|\.env\.|credentials|secret/i.test(filePath)) {
      console.error('[ECC] BLOCKED: Tab cannot read sensitive file: ' + filePath);
      process.exit(2);
    }
  } catch {}
  process.stdout.write(raw);
}).catch(() => process.exit(0));
