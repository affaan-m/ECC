'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const binPath = path.join(__dirname, '..', 'bin', 'energy-tracker.js');

function run(args, filePath) {
  return spawnSync(process.execPath, [binPath, '--file', filePath, ...args], {
    encoding: 'utf8'
  });
}

function withTempFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-tracker-test-'));
  const filePath = path.join(dir, 'watchlist.json');
  try {
    fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('add then list shows the new company as watching', () => {
  withTempFile(filePath => {
    const add = run(['add', 'Voltus', '--segment', 'Demand Response'], filePath);
    assert.equal(add.status, 0);
    assert.match(add.stdout, /#1/);

    const list = run(['list'], filePath);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /Voltus/);
    assert.match(list.stdout, /Demand Response/);
  });
});

test('add without --segment exits non-zero with a usage error', () => {
  withTempFile(filePath => {
    const add = run(['add', 'Voltus'], filePath);
    assert.notEqual(add.status, 0);
    assert.match(add.stderr, /segment/i);
  });
});

test('list --segment filters, list --all includes archived companies', () => {
  withTempFile(filePath => {
    run(['add', 'Voltus', '--segment', 'Demand Response'], filePath);
    run(['add', 'GridBeyond', '--segment', 'VPP'], filePath);
    run(['archive', '2'], filePath);

    const derOnly = run(['list', '--segment', 'Demand Response'], filePath);
    assert.match(derOnly.stdout, /Voltus/);
    assert.doesNotMatch(derOnly.stdout, /GridBeyond/);

    const active = run(['list'], filePath);
    assert.doesNotMatch(active.stdout, /GridBeyond/);

    const all = run(['list', '--all'], filePath);
    assert.match(all.stdout, /GridBeyond/);
  });
});

test('note appends research notes visible in show', () => {
  withTempFile(filePath => {
    run(['add', 'Voltus', '--segment', 'Demand Response'], filePath);
    const note = run(['note', '1', 'Closed $60M Series C'], filePath);
    assert.equal(note.status, 0);

    const show = run(['show', '1'], filePath);
    assert.equal(show.status, 0);
    assert.match(show.stdout, /Closed \$60M Series C/);
  });
});

test('segments summarizes watching companies by segment', () => {
  withTempFile(filePath => {
    run(['add', 'Voltus', '--segment', 'Demand Response'], filePath);
    run(['add', 'CPower', '--segment', 'Demand Response'], filePath);
    run(['add', 'GridBeyond', '--segment', 'VPP'], filePath);

    const segments = run(['segments'], filePath);
    assert.equal(segments.status, 0);
    assert.match(segments.stdout, /Demand Response\s+2/);
    assert.match(segments.stdout, /VPP\s+1/);
  });
});

test('rm permanently removes a company', () => {
  withTempFile(filePath => {
    run(['add', 'Voltus', '--segment', 'Demand Response'], filePath);
    const rm = run(['rm', '1'], filePath);
    assert.equal(rm.status, 0);

    const all = run(['list', '--all'], filePath);
    assert.doesNotMatch(all.stdout, /Voltus/);
  });
});

test('show with an unknown id exits non-zero with a clear error', () => {
  withTempFile(filePath => {
    const show = run(['show', '42'], filePath);
    assert.notEqual(show.status, 0);
    assert.match(show.stderr, /not found/i);
  });
});

test('unknown command exits non-zero and prints an error', () => {
  withTempFile(filePath => {
    const result = run(['bogus'], filePath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown command/i);
  });
});
