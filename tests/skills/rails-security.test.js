'use strict';

// Tests for the rails-security skill: the SKILL.md upload guidance must match what Rails
// actually does. Assert the document's claims, then run the real Active Storage fixture so
// the published example and its verified behavior share one source.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'rails-security', 'SKILL.md');
const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'rails-security', 'uploads.rb');
const skill = fs.readFileSync(skillPath, 'utf8');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

function skip(name, reason) {
  skipped += 1;
  console.log(`  - ${name} (${reason})`);
}

console.log('\n=== Rails security skill tests ===\n');

// ---- Skill document claims ---------------------------------------------

test('upload guidance does not treat blob.content_type as byte evidence', () => {
  assert.doesNotMatch(skill, /ALLOWED\.include\?\(\s*(file\.)?blob\.content_type\s*\)/);
  assert.doesNotMatch(skill, /identify unless .*identified\?/);
  assert.match(skill, /download_chunk\(blob\.key, 0\.\.\.8\)/);
});

test('upload guidance states the declared-type fallback', () => {
  assert.match(skill, /Marcel::MimeType\.for/);
  assert.match(skill, /bytes match nothing known/);
});

test('upload guidance fails closed on an unavailable object', () => {
  assert.match(skill, /blob\.service\.exist\?\(blob\.key\)/);
  assert.match(skill, /could not be verified/);
});

test('upload guidance names both upload entry points', () => {
  assert.match(skill, /ActiveStorage::Blob\.create_and_upload!/);
  assert.match(skill, /ActiveStorage::Blob\.find_signed!/);
});

test('verification checklist matches the byte-level guidance', () => {
  assert.match(skill, /Uploads validated against stored bytes, not `blob\.content_type`/);
});

// ---- The fixture carries the published verifier verbatim ----------------

function uploadsModule(source) {
  const start = source.indexOf('module Uploads');
  const end = source.indexOf('\nend\n', source.indexOf('def self.verified!'));
  assert.ok(start > -1 && end > start, 'Uploads module not found');
  return source.slice(start, end + 5).trim();
}

test('fixture verifier has not drifted from the published example', () => {
  const documented = uploadsModule(skill);
  const fixture = uploadsModule(fs.readFileSync(fixturePath, 'utf8'));
  assert.strictEqual(fixture, documented, 'fixture drifted from the skill');
});

// ---- Execute the fixture against a real Active Storage lifecycle --------

// Prefer `bundle exec` so a bundled Rails is found, and fall back to a plain
// interpreter for developers who already have the gems installed.
const RUNNERS = [
  ['bundle', ['exec', 'ruby']],
  ['ruby', []],
];

function runFixture() {
  const env = { ...process.env, RAILS_ENV: 'test' };
  const probeSource = 'require "rails"; require "active_storage/engine"';

  for (const [command, prefix] of RUNNERS) {
    const probe = spawnSync(command, [...prefix, '-e', probeSource], {
      encoding: 'utf8',
      cwd: path.dirname(fixturePath),
      env,
    });
    if (probe.error || probe.status !== 0) continue;

    const result = spawnSync(command, [...prefix, fixturePath], {
      encoding: 'utf8',
      cwd: path.dirname(fixturePath),
      env,
    });
    assert.strictEqual(result.status, 0, `fixture failed:\n${result.stderr}`);
    return result.stdout
      .split('\n')
      .filter(line => line.startsWith('{'))
      .map(line => JSON.parse(line));
  }
  return null;
}

const cases = runFixture();

if (cases === null) {
  skip('Active Storage lifecycle cases', 'ruby with rails and activestorage not available');
} else {
  const byName = new Map(cases.map(entry => [entry.case, entry]));
  const expectCase = name => {
    const entry = byName.get(name);
    assert.ok(entry, `fixture did not report the ${name} case`);
    return entry;
  };

  test('a legitimate PNG is attached', () => {
    const result = expectCase('legitimate_png');
    assert.strictEqual(result.attached, true);
    assert.strictEqual(result.rejected, null);
  });

  test('opaque bytes are stored under the declared type and still rejected', () => {
    const result = expectCase('opaque_declared_png');
    // The bypass: Rails kept the client's declared type and marked the blob identified.
    assert.strictEqual(result.stored_content_type, 'image/png');
    assert.strictEqual(result.identified, true);
    assert.strictEqual(result.attached, false);
    assert.strictEqual(result.rejected, 'type not allowed');
  });

  test('a ZIP declared image/png is rejected', () => {
    const result = expectCase('zip_declared_png');
    assert.strictEqual(result.attached, false);
    assert.strictEqual(result.rejected, 'type not allowed');
  });

  test('a disallowed extension is rejected on otherwise valid bytes', () => {
    const result = expectCase('png_bytes_bad_extension');
    assert.strictEqual(result.attached, false);
    assert.strictEqual(result.rejected, 'extension not allowed');
  });

  test('a pending direct upload fails closed', () => {
    const result = expectCase('pending_direct_upload');
    assert.strictEqual(result.attached, false);
    assert.strictEqual(result.rejected, 'could not be verified');
  });

  test('an object deleted after identification fails closed', () => {
    const result = expectCase('deleted_after_identification');
    assert.strictEqual(result.stored_content_type, 'image/png');
    assert.strictEqual(result.attached, false);
    assert.strictEqual(result.rejected, 'could not be verified');
  });
}

console.log(`\nPassed: ${passed}`);
if (skipped > 0) console.log(`Skipped: ${skipped}`);
if (failed > 0) {
  console.log(`Failed: ${failed}`);
  process.exit(1);
}
