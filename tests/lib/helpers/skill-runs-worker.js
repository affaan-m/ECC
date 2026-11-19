'use strict';

const fs = require('fs');
const path = require('path');
const { recordSkillExecution } = require('../../../scripts/lib/skill-evolution/tracker');

const [root, role] = process.argv.slice(2);
const runsFilePath = path.join(root, 'runs.jsonl');
const signal = name => fs.writeFileSync(path.join(root, name), '');
if (role === 'owner') {
  const read = fs.readFileSync;
  let paused = false;
  fs.readFileSync = function (file, ...args) {
    const contents = read.call(this, file, ...args);
    if (file === runsFilePath && !paused) {
      paused = true;
      signal('snapshot-ready');
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + 15000;
      while (!fs.existsSync(path.join(root, 'release'))) {
        if (Date.now() > deadline) throw new Error('Owner release deadline exceeded');
        Atomics.wait(sleeper, 0, 0, 10);
      }
    }
    return contents;
  };
} else {
  const link = fs.linkSync;
  fs.linkSync = function (source, target) {
    try { return link.call(this, source, target); }
    catch (error) {
      if (target === `${runsFilePath}.ecc.lock` && error.code === 'EEXIST') signal('contended');
      throw error;
    }
  };
}

recordSkillExecution({
  skill_id: role, skill_version: 'v1', task_description: 'Concurrent run',
  outcome: 'success', recorded_at: '2026-03-15T12:00:00.000Z',
}, { runsFilePath, maxRecords: 2 });
signal(`${role}-finished`);
