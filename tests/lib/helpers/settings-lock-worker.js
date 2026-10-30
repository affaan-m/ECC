'use strict';
const fs = require('fs');
const path = require('path');
const { acquireSettingsLock } = require('../../../scripts/lib/install/claude-settings-lock');
const [root, settingsPath] = process.argv.slice(2);
const release = acquireSettingsLock(settingsPath);
fs.writeFileSync(path.join(root, 'held'), '');
const deadline = Date.now() + 15000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
while (!fs.existsSync(path.join(root, 'release'))) {
  if (Date.now() > deadline) throw new Error('Owner release barrier timed out');
  Atomics.wait(sleeper, 0, 0, 10);
}
release();
