'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createSourceReader } = require('../../scripts/lib/context-profile-support');
const { withFixture } = require('./helpers/context-fixture');

const DIRECTORY_LIMIT = 10000;
const TRAVERSAL_LIMIT = 20000;

function mockEnumeration(context, entriesFor) {
  const counts = { opens: 0, reads: 0, closes: 0, wholeDirectoryReads: 0 };
  context.mock.method(fs, 'readdirSync', filename => {
    counts.wholeDirectoryReads++;
    return entriesFor(filename);
  });
  context.mock.method(fs, 'opendirSync', (filename, options) => {
    assert.equal(options.bufferSize, 32);
    counts.opens++;
    const entries = entriesFor(filename);
    let index = 0;
    return {
      readSync() { counts.reads++; return index < entries.length ? { name: entries[index++] } : null; },
      closeSync() { counts.closes++; },
    };
  });
  return counts;
}

test('wide directories stop after one bounded lookahead without allocating a whole listing', context => withFixture(root => {
  const reader = createSourceReader(root);
  const counts = mockEnumeration(context, () => Array.from({ length: DIRECTORY_LIMIT + 100 }, (_, index) => `entry-${index}`));
  try {
    assert.throws(() => reader.list('skills'), /directory.*limit/i);
    assert.equal(counts.wholeDirectoryReads, 0);
    assert.equal(counts.reads, DIRECTORY_LIMIT + 1);
    assert.equal(counts.closes, 1);
  } finally { context.mock.restoreAll(); }
}));

test('exact per-directory limit is accepted and sorted only after bounded enumeration', context => withFixture(root => {
  const reader = createSourceReader(root);
  const names = Array.from({ length: DIRECTORY_LIMIT }, (_, index) => `entry-${String(index).padStart(5, '0')}`);
  const counts = mockEnumeration(context, () => [...names].reverse());
  try {
    assert.deepEqual(reader.list('skills'), names);
    assert.equal(counts.wholeDirectoryReads, 0);
    assert.equal(counts.reads, DIRECTORY_LIMIT + 1);
    assert.equal(counts.closes, 1);
  } finally { context.mock.restoreAll(); }
}));

test('directory-only breadth consumes the shared traversal budget even when no files exist', context => withFixture(root => {
  const reader = createSourceReader(root);
  const base = path.join(fs.realpathSync(root), 'skills/feature');
  const directoryStats = fs.lstatSync(base);
  const originalStat = fs.lstatSync;
  const names = Array.from({ length: DIRECTORY_LIMIT }, (_, index) => `dir-${index}`);
  const counts = mockEnumeration(context, filename => filename === base ? names : []);
  context.mock.method(fs, 'lstatSync', (filename, ...args) => (
    filename.startsWith(`${base}${path.sep}dir-`) ? directoryStats : originalStat(filename, ...args)
  ));
  context.mock.method(fs, 'openSync', () => { throw new Error('Directory-only traversal must not open file bytes'); });
  try {
    assert.throws(() => reader.walk('skills/feature'), /traversal.*limit/i);
    assert.equal(counts.wholeDirectoryReads, 0);
    assert.equal(counts.opens + names.length, TRAVERSAL_LIMIT);
    assert.equal(counts.closes, counts.opens);
  } finally { context.mock.restoreAll(); }
}));

test('excluded cache names consume enumeration limits before filtering', context => withFixture(root => {
  const reader = createSourceReader(root);
  const counts = mockEnumeration(context, () => Array.from({ length: DIRECTORY_LIMIT + 1 }, (_, index) => `cache-${index}.pyc`));
  try {
    assert.throws(() => reader.walk('skills/feature'), /directory.*limit/i);
    assert.equal(counts.reads, DIRECTORY_LIMIT + 1);
    assert.equal(counts.closes, 1);
  } finally { context.mock.restoreAll(); }
}));

test('enumeration errors close the directory handle', context => withFixture(root => {
  const reader = createSourceReader(root);
  let closes = 0;
  context.mock.method(fs, 'opendirSync', () => ({
    readSync() { throw new Error('TEST_DIRECTORY_READ_FAILURE'); },
    closeSync() { closes++; },
  }));
  context.mock.method(fs, 'readdirSync', () => { throw new Error('TEST_DIRECTORY_READ_FAILURE'); });
  try {
    assert.throws(() => reader.list('skills'), /TEST_DIRECTORY_READ_FAILURE/);
    assert.equal(closes, 1);
  } finally { context.mock.restoreAll(); }
}));

test('directory identity changes during open close the handle before reading any entries', context => withFixture(root => {
  const reader = createSourceReader(root);
  const directory = path.join(fs.realpathSync(root), 'skills');
  const originalStat = fs.lstatSync;
  let opened = false;
  let reads = 0;
  let closes = 0;
  context.mock.method(fs, 'opendirSync', () => {
    opened = true;
    return { readSync() { reads++; return null; }, closeSync() { closes++; } };
  });
  context.mock.method(fs, 'lstatSync', (filename, ...args) => {
    const stats = originalStat(filename, ...args);
    if (opened && filename === directory) stats.ino++;
    return stats;
  });
  try {
    assert.throws(() => reader.list('skills'), /identity.*changed/i);
    assert.equal(reads, 0);
    assert.equal(closes, 1);
  } finally { context.mock.restoreAll(); }
}));

test('directory identity changes during enumeration reject the result and close the handle', context => withFixture(root => {
  const reader = createSourceReader(root);
  const directory = path.join(fs.realpathSync(root), 'skills');
  const originalStat = fs.lstatSync;
  let enumerated = false;
  let closes = 0;
  context.mock.method(fs, 'opendirSync', () => ({
    readSync() { enumerated = true; return null; },
    closeSync() { closes++; },
  }));
  context.mock.method(fs, 'lstatSync', (filename, ...args) => {
    const stats = originalStat(filename, ...args);
    if (enumerated && filename === directory) stats.ino++;
    return stats;
  });
  try {
    assert.throws(() => reader.list('skills'), /identity.*changed/i);
    assert.equal(closes, 1);
  } finally { context.mock.restoreAll(); }
}));
