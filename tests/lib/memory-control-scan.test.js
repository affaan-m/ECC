'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  MAX_BODY_BYTES,
  hasUnsafeControlCharacters,
  normalizeMemory,
  parseMemoryDocument,
  serializeMemoryDocument,
} = require('../../scripts/lib/memory-vault-format');
const { resolveVaultRoots, saveMemory, searchMemories } = require('../../scripts/lib/memory-vault');

function memory(overrides = {}) {
  return {
    schema: 'ecc.memory.v1',
    id: 'mem_control_scan',
    title: 'Unicode search context',
    kind: 'note',
    scope: 'project',
    trust: 'unreviewed',
    status: 'active',
    sourceHarness: 'claude',
    targetHarnesses: ['all'],
    tags: ['unicode'],
    links: [],
    createdAt: '2026-11-17T00:00:00.000Z',
    updatedAt: '2026-11-17T00:00:00.000Z',
    body: 'Searchable context.',
    ...overrides,
  };
}

test('control scanning preserves the policy for every Unicode code point', () => {
  const forbidden = new Set([
    ...Array.from({ length: 32 }, (_, index) => index),
    ...Array.from({ length: 33 }, (_, index) => index + 127),
    0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
    0x2066, 0x2067, 0x2068, 0x2069,
  ]);
  const bodyWhitespace = new Set([9, 10, 13]);
  for (let point = 0; point <= 0x10ffff; point += 1) {
    const character = String.fromCodePoint(point);
    for (const allowBodyWhitespace of [false, true]) {
      const expected = forbidden.has(point) && !(allowBodyWhitespace && bodyWhitespace.has(point));
      const actual = hasUnsafeControlCharacters(character, allowBodyWhitespace);
      if (actual !== expected) {
        assert.fail(`Unexpected policy for U+${point.toString(16)} with body whitespace ${allowBodyWhitespace}`);
      }
    }
  }
  assert.equal(hasUnsafeControlCharacters(''), false);
});

test('large bodies preserve control rejection at both ends and body-only whitespace', () => {
  const ordinary = 'x'.repeat(MAX_BODY_BYTES - 1);
  for (const control of ['\u0000', '\u000b', '\u007f', '\u009f', '\u202a', '\u2069']) {
    assert.equal(hasUnsafeControlCharacters(`${control}${ordinary}`, true), true);
    assert.equal(hasUnsafeControlCharacters(`${ordinary}${control}`, true), true);
  }
  for (const whitespace of ['\t', '\n', '\r']) {
    assert.equal(hasUnsafeControlCharacters(`${ordinary}${whitespace}`, true), false);
    assert.equal(hasUnsafeControlCharacters(`${ordinary}${whitespace}`), true);
  }
});

test('maximum-size Unicode bodies round-trip without changing byte limits or validation', () => {
  const body = `${'😀'.repeat((MAX_BODY_BYTES - 16) / 4)}\tcontext\nends!!!`;
  assert.equal(Buffer.byteLength(body), MAX_BODY_BYTES);
  const value = memory({ body });
  assert.deepEqual(parseMemoryDocument(serializeMemoryDocument(value)), value);
  assert.throws(() => normalizeMemory(memory({ body: `${body}x` })), /too large/);
  assert.throws(() => normalizeMemory(memory({ title: 'before\nafter' })), /control/);
  assert.throws(() => normalizeMemory(memory({ body: `before\u2067after` })), /control/);
  const ordinaryUnicode = '中文 বাংলা 😀 \ud800 \udfff \u200e \u200f \u2028 \u2029';
  assert.equal(hasUnsafeControlCharacters(ordinaryUnicode), false);
});

test('real vault and CLI search retain valid Unicode memories and quarantine controls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-control-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    const roots = resolveVaultRoots({ cwd: root, homeDir: root, env: {} });
    const body = 'Unicode context 😀 বাংলা 中文\n'.repeat(300);
    const saved = saveMemory({ title: 'Unicode context', body }, {
      roots,
      idFactory: () => 'mem_valid_control',
      now: () => '2026-11-17T00:00:00.000Z',
    });
    const invalid = memory({ id: 'mem_invalid_control', body: 'Before control marker after.' });
    const invalidSource = serializeMemoryDocument(invalid).replace('control marker', '\u202econtrol marker');
    fs.writeFileSync(path.join(path.dirname(saved.path), `${invalid.id}.md`), invalidSource);
    assert.throws(() => saveMemory({ title: 'invalid', body: 'before\u0000after' }, { roots }), /control/);
    assert.throws(() => searchMemories('Unicode\ncontext', { roots }), /control/);

    const result = searchMemories('Unicode', { roots });
    assert.deepEqual(result.results.map(item => item.memory.id), [saved.memory.id]);
    assert.equal(result.diagnostics.invalidFileCount, 1);
    assert.equal(result.diagnostics.invalidFiles[0].code, 'invalid-document');
    const cli = spawnSync(process.execPath, [
      path.resolve(__dirname, '../../scripts/memory.js'), 'search', 'Unicode', '--json',
    ], {
      cwd: root,
      env: { ...process.env, ECC_MEMORY_PROJECT_ROOT: path.dirname(roots.project) },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(cli.status, 0, cli.stderr);
    const payload = JSON.parse(cli.stdout);
    assert.deepEqual(payload.results, result.results);
    assert.deepEqual(payload.diagnostics, result.diagnostics);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
