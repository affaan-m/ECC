'use strict';
const fs = require('fs');
const path = require('path');
const [root, role, action] = process.argv.slice(2);
const aliasesPath = path.join(root, '.claude', 'session-aliases.json');
const pause = new Int32Array(new SharedArrayBuffer(4));
const mark = name => fs.writeFileSync(path.join(root, name), '');
const readFileSync = fs.readFileSync;
const linkSync = fs.linkSync;
let paused = false;
// Announce a lock attempt OR a captured read; the parent needs no scheduling guess.
fs.linkSync = function (source, target) {
  if (target === aliasesPath + '.ecc.lock') mark(role + '.attempt');
  return linkSync.apply(this, arguments);
};
fs.readFileSync = function (file) {
  const result = readFileSync.apply(this, arguments);
  if (file === aliasesPath && !paused) {
    paused = true;
    mark(role + '.attempt');
    mark(role + '.read');
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(path.join(root, role + '.release'))) {
      if (Date.now() > deadline) throw new Error('Read barrier timed out');
      Atomics.wait(pause, 0, 0, 10);
    }
  }
  return result;
};
const aliases = require('../../../scripts/lib/session-aliases');
const actions = {
  set: () => aliases.setAlias('beta', '/beta'),
  delete: () => aliases.deleteAlias('existing'),
  rename: () => aliases.renameAlias('existing', 'renamed'),
  title: () => aliases.updateAliasTitle('existing', 'Updated'),
  cleanup: () => aliases.cleanupAliases(session => session !== '/existing'),
};
const result = role === 'alpha' ? aliases.setAlias('alpha', '/alpha') : actions[action]();
process.stdout.write(JSON.stringify(result));
