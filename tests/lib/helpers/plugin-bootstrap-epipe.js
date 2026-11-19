'use strict';

// Isolate the child-result contract from an OS scheduling race: a missing
// target can exit 1 while closing stdin before the bootstrap finishes writing.
const assert = require('assert');
const path = require('path');
const childProcess = require('child_process');
const target = path.resolve(process.env.CLAUDE_PLUGIN_ROOT, 'scripts', 'missing.js');

childProcess.spawnSync = (command, args) => {
  assert.strictEqual(command, process.execPath);
  assert.deepStrictEqual(args, [target]);
  process.stderr.write('[TestSpawn] child exited 1 with EPIPE\n');
  return {
    status: 1, signal: null, stdout: Buffer.alloc(0),
    stderr: Buffer.from("Error: Cannot find module 'missing fixture'\n"),
    error: Object.assign(new Error('spawnSync node EPIPE'), { code: 'EPIPE' }),
  };
};
