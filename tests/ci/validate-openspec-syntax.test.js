/**
 * Tests for scripts/ci/validate-openspec-syntax.js
 *
 * Run with: node tests/ci/validate-openspec-syntax.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseBlocks,
  validateSpec,
  checkIdUniqueness,
  validateDelta,
  collectSpecs,
  collectDeltas,
} = require('../../scripts/ci/validate-openspec-syntax');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
  }
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-openspec-syntax-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function writeSpec(dir, content) {
  const specsDir = path.join(dir, 'openspec', 'specs', 'test-capability');
  fs.mkdirSync(specsDir, { recursive: true });
  const specPath = path.join(specsDir, 'spec.md');
  fs.writeFileSync(specPath, content);
  return specPath;
}

function writeSpecAt(dir, capability, content) {
  const specsDir = path.join(dir, 'openspec', 'specs', capability);
  fs.mkdirSync(specsDir, { recursive: true });
  const specPath = path.join(specsDir, 'spec.md');
  fs.writeFileSync(specPath, content);
  return specPath;
}

function writeDelta(dir, content) {
  const deltasDir = path.join(dir, 'openspec', 'deltas', 'test-delta');
  fs.mkdirSync(deltasDir, { recursive: true });
  const deltaPath = path.join(deltasDir, 'delta.md');
  fs.writeFileSync(deltaPath, content);
  return deltaPath;
}

// ================================================================
// collectSpecs / collectDeltas
// ================================================================
console.log('\n--- collectSpecs / collectDeltas ---');

test('collectSpecs returns empty array for non-existent dir', () => {
  assert.deepStrictEqual(collectSpecs('/tmp/non-existent-dir-xyz-12345'), []);
});

test('collectSpecs finds spec.md files recursively', () => {
  const dir = createTestDir();
  try {
    fs.mkdirSync(path.join(dir, 'auth'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'auth', 'spec.md'), '# Auth');
    fs.writeFileSync(path.join(dir, 'db', 'spec.md'), '# DB');
    fs.writeFileSync(path.join(dir, 'db', 'README.md'), '# Readme');

    const result = collectSpecs(dir);
    assert.strictEqual(result.length, 2);
  } finally {
    cleanupTestDir(dir);
  }
});

test('collectSpecs returns empty for empty dir', () => {
  const dir = createTestDir();
  try {
    const result = collectSpecs(dir);
    assert.deepStrictEqual(result, []);
  } finally {
    cleanupTestDir(dir);
  }
});

test('collectDeltas returns empty array for non-existent dir', () => {
  assert.deepStrictEqual(collectDeltas('/tmp/non-existent-dir-xyz-12345'), []);
});

test('collectDeltas finds delta.md files', () => {
  const dir = createTestDir();
  try {
    fs.mkdirSync(path.join(dir, 'delta-1'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'delta-2'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'delta-1', 'delta.md'), '# Delta 1');
    fs.writeFileSync(path.join(dir, 'delta-2', 'delta.md'), '# Delta 2');

    const result = collectDeltas(dir);
    assert.strictEqual(result.length, 2);
  } finally {
    cleanupTestDir(dir);
  }
});

test('collectDeltas ignores non-delta.md files', () => {
  const dir = createTestDir();
  try {
    fs.mkdirSync(path.join(dir, 'stuff'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'stuff', 'delta.md'), '# Delta');
    fs.writeFileSync(path.join(dir, 'stuff', 'notes.txt'), 'notes');

    const result = collectDeltas(dir);
    assert.strictEqual(result.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

// ================================================================
// parseBlocks
// ================================================================
console.log('\n--- parseBlocks ---');

test('parses a Requirement with Scenarios', () => {
  const content = [
    '### Requirement: User Authentication',
    '<!-- enforced: AuthService.authenticate -->',
    '#### Scenario: Valid credentials',
    '#### Scenario: Invalid credentials',
  ].join('\n');
  const blocks = parseBlocks(content);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].type, 'Requirement');
  assert.strictEqual(blocks[0].name, 'User Authentication');
  assert.strictEqual(blocks[0].hasScenario, true);
  assert.strictEqual(blocks[0].scenarios.length, 2);
  assert.strictEqual(blocks[0].scenarios[0].name, 'Valid credentials');
  assert.strictEqual(blocks[0].scenarios[1].name, 'Invalid credentials');
  assert.strictEqual(blocks[0].metadata.enforced, 'AuthService.authenticate');
});

test('parses an Invariant without Scenarios', () => {
  const content = [
    '### Invariant: Data Integrity',
    '<!-- enforced: Database.validate -->',
  ].join('\n');
  const blocks = parseBlocks(content);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].type, 'Invariant');
  assert.strictEqual(blocks[0].name, 'Data Integrity');
  assert.strictEqual(blocks[0].hasScenario, false);
  assert.strictEqual(blocks[0].scenarios.length, 0);
});

test('detects Scenario with 3 hashtags (wrong depth)', () => {
  const content = [
    '### Requirement: Login',
    '<!-- enforced: LoginService.login -->',
    '### Scenario: Wrong depth',
  ].join('\n');
  const blocks = parseBlocks(content);
  assert.strictEqual(blocks.length, 1);
  assert.ok(blocks[0].scenarioDepthError);
  assert.strictEqual(blocks[0].scenarioDepthError.actual, 3);
});

test('detects Scenario with 5 hashtags (wrong depth)', () => {
  const content = [
    '### Requirement: Login',
    '<!-- enforced: LoginService.login -->',
    '##### Scenario: Too deep',
  ].join('\n');
  const blocks = parseBlocks(content);
  assert.strictEqual(blocks[0].scenarioDepthError.actual, 5);
});

test('parses all valid metadata keys', () => {
  const content = [
    '### Requirement: Full Meta',
    '<!-- id: Test.fullMeta -->',
    '<!-- entities: User,Session -->',
    '<!-- enforced: Test.validate -->',
    '<!-- test: unit -->',
    '<!-- verified_by: e2e -->',
    '<!-- depends_on: Auth -->',
    '<!-- triggers: Deploy -->',
    '<!-- uncertainty: medium -->',
    '<!-- deferred: false -->',
    '<!-- delta: added -->',
      '#### Scenario: Works',
  ].join('\n');
  const blocks = parseBlocks(content);
  const meta = blocks[0].metadata;
  assert.strictEqual(meta.id, 'Test.fullMeta');
  assert.strictEqual(meta.entities, 'User,Session');
  assert.strictEqual(meta.enforced, 'Test.validate');
  assert.strictEqual(meta.test, 'unit');
  assert.strictEqual(meta.verified_by, 'e2e');
  assert.strictEqual(meta.depends_on, 'Auth');
  assert.strictEqual(meta.triggers, 'Deploy');
  assert.strictEqual(meta.uncertainty, 'medium');
  assert.strictEqual(meta.deferred, 'false');
  assert.strictEqual(meta.delta, 'added');
});

test('flags unknown metadata keys', () => {
  const content = [
    '### Requirement: Bad Meta',
    '<!-- enforced: Test.validate -->',
    '<!-- unknown_key: value -->',
    '<!-- another_bad: x -->',
    '#### Scenario: Works',
  ].join('\n');
  const blocks = parseBlocks(content);
  assert.ok(blocks[0].unknownKeys);
  assert.strictEqual(blocks[0].unknownKeys.length, 2);
  assert.strictEqual(blocks[0].unknownKeys[0].key, 'unknown_key');
  assert.strictEqual(blocks[0].unknownKeys[1].key, 'another_bad');
});

test('handles multiple blocks of different types', () => {
  const content = [
    '### Requirement: First',
    '<!-- enforced: First.validate -->',
    '#### Scenario: One',
    '### Invariant: Always True',
    '<!-- enforced: Inv.check -->',
    '### Requirement: Second',
    '<!-- enforced: Second.validate -->',
    '#### Scenario: Two',
    '#### Scenario: Three',
  ].join('\n');
  const blocks = parseBlocks(content);
  assert.strictEqual(blocks.length, 3);
  assert.strictEqual(blocks[0].type, 'Requirement');
  assert.strictEqual(blocks[1].type, 'Invariant');
  assert.strictEqual(blocks[2].type, 'Requirement');
  assert.strictEqual(blocks[0].hasScenario, true);
  assert.strictEqual(blocks[1].hasScenario, false);
  assert.strictEqual(blocks[2].hasScenario, true);
  assert.strictEqual(blocks[2].scenarios.length, 2);
});

test('handles empty content', () => {
  const blocks = parseBlocks('');
  assert.strictEqual(blocks.length, 0);
});

test('ignores text before first block', () => {
  const content = [
    '# Some Header',
    'Some introductory text.',
    '### Requirement: After Text',
    '<!-- enforced: Test.validate -->',
    '#### Scenario: One',
  ].join('\n');
  const blocks = parseBlocks(content);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].name, 'After Text');
});

test('Requirement name is trimmed', () => {
  const content = [
    '### Requirement:   Padded Name   ',
    '<!-- enforced: Test.validate -->',
    '#### Scenario: One',
  ].join('\n');
  const blocks = parseBlocks(content);
  assert.strictEqual(blocks[0].name, 'Padded Name');
});

// ================================================================
// validateSpec
// ================================================================
console.log('\n--- validateSpec ---');

test('valid spec returns no errors', () => {
  const dir = createTestDir();
  try {
    const content = [
      '### Requirement: Valid',
      '<!-- enforced: Valid.check -->',
      '#### Scenario: Works',
    ].join('\n');
    const specPath = writeSpec(dir, content);
    const errors = validateSpec(specPath);
    assert.strictEqual(errors.length, 0);
  } finally {
    cleanupTestDir(dir);
  }
});

test('Requirement without Scenarios produces error', () => {
  const dir = createTestDir();
  try {
    const content = [
      '### Requirement: No Scenarios',
      '<!-- enforced: Test.check -->',
    ].join('\n');
    const specPath = writeSpec(dir, content);
    const errors = validateSpec(specPath);
    const match = errors.filter(e => e.error.includes('has no Scenarios'));
    assert.strictEqual(match.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

test('missing enforced metadata on Requirement produces error', () => {
  const dir = createTestDir();
  try {
    const content = [
      '### Requirement: Missing Enforced',
      '#### Scenario: Works',
    ].join('\n');
    const specPath = writeSpec(dir, content);
    const errors = validateSpec(specPath);
    const match = errors.filter(e => e.error.includes('missing <!-- enforced: -->'));
    assert.strictEqual(match.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

test('missing enforced metadata on Invariant produces error', () => {
  const dir = createTestDir();
  try {
    const content = [
      '### Invariant: Missing Enforced',
    ].join('\n');
    const specPath = writeSpec(dir, content);
    const errors = validateSpec(specPath);
    const match = errors.filter(e => e.error.includes('missing <!-- enforced: -->'));
    assert.strictEqual(match.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

test('Invariant with Scenarios produces error', () => {
  const dir = createTestDir();
  try {
    const content = [
      '### Invariant: Has Scenarios',
      '<!-- enforced: Inv.check -->',
      '#### Scenario: Should not exist',
    ].join('\n');
    const specPath = writeSpec(dir, content);
    const errors = validateSpec(specPath);
    const match = errors.filter(e => e.error.includes('Invariant') && e.error.includes('Scenarios'));
    assert.strictEqual(match.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

test('Scenario depth error is reported', () => {
  const dir = createTestDir();
  try {
    const content = [
      '### Requirement: Depth Check',
      '<!-- enforced: Test.check -->',
      '### Scenario: Wrong depth',
    ].join('\n');
    const specPath = writeSpec(dir, content);
    const errors = validateSpec(specPath);
    const match = errors.filter(e => e.error.includes('hashtags'));
    assert.strictEqual(match.length, 1);
    assert.ok(match[0].error.includes('3 hashtags'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('unknown metadata key produces error with key names listed', () => {
  const dir = createTestDir();
  try {
    const content = [
      '### Requirement: Bad Meta',
      '<!-- enforced: Test.check -->',
      '<!-- not_a_key: value -->',
      '#### Scenario: Works',
    ].join('\n');
    const specPath = writeSpec(dir, content);
    const errors = validateSpec(specPath);
    const match = errors.filter(e => e.error.includes('Unknown metadata key'));
    assert.strictEqual(match.length, 1);
    assert.ok(match[0].error.includes('Valid keys:'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('non-existent file returns readable error', () => {
  const errors = validateSpec('/tmp/non-existent-openspec-spec-md-12345.md');
  assert.ok(errors.length > 0);
  assert.ok(errors[0].error.includes('Failed to read file'));
});

test('valid Invariant with enforced but no Scenarios is OK', () => {
  const dir = createTestDir();
  try {
    const content = [
      '### Invariant: Data Always Valid',
      '<!-- enforced: DataGuard.validate -->',
    ].join('\n');
    const specPath = writeSpec(dir, content);
    const errors = validateSpec(specPath);
    assert.strictEqual(errors.length, 0);
  } finally {
    cleanupTestDir(dir);
  }
});

// ================================================================
// checkIdUniqueness
// ================================================================
console.log('\n--- checkIdUniqueness ---');

test('unique IDs across specs produce no errors', () => {
  const dir = createTestDir();
  try {
    const specPath1 = writeSpecAt(dir, 'cap-a', [
      '### Requirement: First',
      '<!-- id: First.one -->',
      '<!-- enforced: First.check -->',
      '#### Scenario: One',
    ].join('\n'));
    const specPath2 = writeSpecAt(dir, 'cap-b', [
      '### Requirement: Second',
      '<!-- id: Second.two -->',
      '<!-- enforced: Second.check -->',
      '#### Scenario: Two',
    ].join('\n'));
    const errors = checkIdUniqueness([specPath1, specPath2]);
    assert.strictEqual(errors.length, 0);
  } finally {
    cleanupTestDir(dir);
  }
});

test('duplicate IDs across files produce error', () => {
  const dir = createTestDir();
  try {
    const specPath1 = writeSpecAt(dir, 'cap-a', [
      '### Requirement: First',
      '<!-- id: Duplicate.same -->',
      '<!-- enforced: First.check -->',
      '#### Scenario: One',
    ].join('\n'));
    const specPath2 = writeSpecAt(dir, 'cap-b', [
      '### Requirement: Second',
      '<!-- id: Duplicate.same -->',
      '<!-- enforced: Second.check -->',
      '#### Scenario: Two',
    ].join('\n'));
    const errors = checkIdUniqueness([specPath1, specPath2]);
    const dupErrors = errors.filter(e => e.error.includes('Duplicate id'));
    assert.strictEqual(dupErrors.length, 1);
    assert.ok(dupErrors[0].error.includes('Duplicate.same'));
    assert.ok(dupErrors[0].error.includes('also found in'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('duplicate IDs within a single file are detected', () => {
  const dir = createTestDir();
  try {
    const content = [
      '### Requirement: First',
      '<!-- id: Internal.dup -->',
      '<!-- enforced: First.check -->',
      '#### Scenario: One',
      '### Requirement: Second',
      '<!-- id: Internal.dup -->',
      '<!-- enforced: Second.check -->',
      '#### Scenario: Two',
    ].join('\n');
    const specPath = writeSpec(dir, content);
    const errors = checkIdUniqueness([specPath]);
    const dupErrors = errors.filter(e => e.error.includes('Duplicate id'));
    assert.strictEqual(dupErrors.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

test('empty list produces no errors', () => {
  const errors = checkIdUniqueness([]);
  assert.strictEqual(errors.length, 0);
});

test('spec with no IDs produces no errors', () => {
  const dir = createTestDir();
  try {
    const specPath = writeSpec(dir, [
      '### Requirement: No IDs',
      '<!-- enforced: Test.check -->',
      '#### Scenario: One',
    ].join('\n'));
    const errors = checkIdUniqueness([specPath]);
    assert.strictEqual(errors.length, 0);
  } finally {
    cleanupTestDir(dir);
  }
});

test('unreadable file produces error but continues', () => {
  const dir = createTestDir();
  try {
    const specPath = writeSpec(dir, [
      '### Requirement: Valid',
      '<!-- id: Valid.one -->',
      '<!-- enforced: Valid.check -->',
      '#### Scenario: One',
    ].join('\n'));
    const errors = checkIdUniqueness([specPath, '/tmp/non-existent-file-xyz.md']);
    const readErrors = errors.filter(e => e.error.includes('Failed to read file for ID scan'));
    assert.strictEqual(readErrors.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

// ================================================================
// validateDelta
// ================================================================
console.log('\n--- validateDelta ---');

test('all six valid sections produce no errors', () => {
  const dir = createTestDir();
  try {
    const content = [
      '## ADDED Requirements',
      '### Requirement: New One',
      '## MODIFIED Requirements',
      '### Requirement: Changed',
      '## REMOVED Requirements',
      '### Requirement: Gone',
      '## ADDED Invariants',
      '### Invariant: New Inv',
      '## MODIFIED Invariants',
      '### Invariant: Changed Inv',
      '## REMOVED Invariants',
      '### Invariant: Removed Inv',
    ].join('\n');
    const deltaPath = writeDelta(dir, content);
    const errors = validateDelta(deltaPath);
    assert.strictEqual(errors.length, 0);
  } finally {
    cleanupTestDir(dir);
  }
});

test('invalid section name produces error', () => {
  const dir = createTestDir();
  try {
    const content = '## WRONG Section\nSome content\n';
    const deltaPath = writeDelta(dir, content);
    const errors = validateDelta(deltaPath);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].error.includes('Invalid delta section'));
    assert.ok(errors[0].error.includes('WRONG Section'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('mixed valid and invalid sections reports only invalid', () => {
  const dir = createTestDir();
  try {
    const content = [
      '## ADDED Requirements',
      '### Requirement: Valid',
      '## BAD Section',
    ].join('\n');
    const deltaPath = writeDelta(dir, content);
    const errors = validateDelta(deltaPath);
    assert.strictEqual(errors.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

test('non-existent file returns readable error', () => {
  const errors = validateDelta('/tmp/non-existent-openspec-delta-md-12345.md');
  assert.ok(errors.length > 0);
  assert.ok(errors[0].error.includes('Failed to read delta file'));
});

// ================================================================
// Direct script invocation (for c8 coverage of main() + collectSpecs/collectDeltas)
// ================================================================
console.log('\n--- direct script invocation ---');

test('script exits 0 against real repo (no specs/deltas to check)', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'ci', 'validate-openspec-syntax.js');
  try {
    const stdout = execFileSync('node', [scriptPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    assert.ok(stdout.includes('No OpenSpec files found') || stdout.includes('all valid'));
  } catch (err) {
    // exit 0 is the success case
    if (err.status !== 0) {
      throw new Error(`Script exited with ${err.status}: ${err.stderr}`);
    }
    const output = err.stdout || '';
    assert.ok(output.includes('No OpenSpec files found') || output.includes('all valid'));
  }
});

// ================================================================
// Results
// ================================================================
console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
