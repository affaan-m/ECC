'use strict';

// Deterministic cold-load accounting for a real run-with-flags subprocess.
// The subprocess's 30-second wall-clock deadline remains outside this clock.
const Module = require('node:module');
const path = require('node:path');
const load = Module._load;
const hookPath = path.resolve(__dirname, '../../../scripts/hooks/context-prompt-suggestions.js');
let elapsed = 0;
Date.now = () => elapsed;

Module._load = function (request, parent, isMain) {
  const loaded = load.call(this, request, parent, isMain);
  if (request === '../lib/context-routing-index' && parent?.filename === hookPath) {
    elapsed += 200;
    process.stderr.write('[TestClock] routing load consumed 200ms\n');
  }
  return loaded;
};
