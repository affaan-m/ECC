#!/usr/bin/env node
'use strict';

/**
 * Clean, readable hook bootstrap entrypoint that delegates to plugin-hook-bootstrap.js
 * or lifecycle-hook-bootstrap.js without embedding single-letter minified node -e
 * code inside session transcripts (avoids Windows Defender heuristic alerts, #2687).
 *
 * Usage:
 *   node scripts/hooks/run-hook-bootstrap.js <hook-id> <script-rel-path> [profiles]
 *   node scripts/hooks/run-hook-bootstrap.js --lifecycle <hook-id> <script-rel-path> [profiles] [timeoutMs]
 */

const fs = require('fs');
const path = require('path');

const rawArgs = process.argv.slice(2);
const lifecycleMode = rawArgs[0] === '--lifecycle';
const forwardedArgs = lifecycleMode ? rawArgs.slice(1) : rawArgs;

const eccRoot = path.resolve(__dirname, '..', '..');
process.env.CLAUDE_PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || eccRoot;

const targetBootstrap = path.join(
  eccRoot,
  'scripts',
  'hooks',
  lifecycleMode ? 'lifecycle-hook-bootstrap.js' : 'plugin-hook-bootstrap.js'
);

if (!fs.existsSync(targetBootstrap)) {
  process.stderr.write(`[Hook] bootstrap target missing at ${targetBootstrap}; skipping\n`);
  process.exit(0);
}

process.argv = [process.argv[0], targetBootstrap, ...forwardedArgs];
const loaded = require(targetBootstrap);
if (lifecycleMode && loaded && typeof loaded.cli === 'function') {
  loaded.cli();
}
