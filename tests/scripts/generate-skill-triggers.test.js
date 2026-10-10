'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const command = path.resolve(__dirname, '../../scripts/dev/generate-skill-triggers.js');

test('trigger generation rejects batch sizes that cannot advance', () => {
  for (const value of ['0', '-1', 'NaN', '1.5', '9007199254740992']) {
    const result = spawnSync(process.execPath, [command, '--batch', value, '--dry-run'], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1, `${value}: ${result.stderr}`);
    assert.match(result.stderr, /--batch must be a positive integer/);
  }
});
