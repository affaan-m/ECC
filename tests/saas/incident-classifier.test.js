'use strict';

/**
 * Tests for incident-classifier.js
 * Run: node tests/saas/incident-classifier.test.js
 */

const assert = require('assert');
const { classifySeverity, sanitizeText, severityLabel } = require('../../src/saas/services/incident-classifier');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

console.log('\nincident-classifier.js');

// ─── classifySeverity ─────────────────────────────────────────────────────────

test('SEV1: critical keyword', () => assert.strictEqual(classifySeverity('critical error'), 1));
test('SEV1: p1 keyword',      () => assert.strictEqual(classifySeverity('p1 alert'), 1));
test('SEV1: outage keyword',  () => assert.strictEqual(classifySeverity('service outage detected'), 1));
test('SEV1: payment keyword', () => assert.strictEqual(classifySeverity('payment system down'), 1));
test('SEV1: data loss',       () => assert.strictEqual(classifySeverity('data loss on prod'), 1));

test('SEV2: degraded',        () => assert.strictEqual(classifySeverity('service degraded'), 2));
test('SEV2: error rate',      () => assert.strictEqual(classifySeverity('error rate elevated'), 2));
test('SEV2: latency',         () => assert.strictEqual(classifySeverity('high latency detected'), 2));
test('SEV2: timeout',         () => assert.strictEqual(classifySeverity('connection timeout'), 2));

test('SEV3: warning',         () => assert.strictEqual(classifySeverity('warning threshold crossed'), 3));
test('SEV3: minor',           () => assert.strictEqual(classifySeverity('minor issue on staging'), 3));

test('SEV4: logging',         () => assert.strictEqual(classifySeverity('logging pipeline issue'), 4));
test('SEV4: info',            () => assert.strictEqual(classifySeverity('info level alert'), 4));

test('Default SEV3 for unknown text', () => assert.strictEqual(classifySeverity('unknown random text'), 3));
test('Empty string returns SEV3',     () => assert.strictEqual(classifySeverity(''), 3));
test('Null returns SEV3',             () => assert.strictEqual(classifySeverity(null), 3));

// ─── sanitizeText ─────────────────────────────────────────────────────────────

test('sanitizeText: strips null bytes',        () => assert.ok(!sanitizeText('test\x00val').includes('\x00')));
test('sanitizeText: strips ESC sequences',     () => assert.ok(!sanitizeText('\x1b[31mred\x1b[0m').includes('\x1b')));
test('sanitizeText: allows newlines',          () => assert.ok(sanitizeText('line1\nline2').includes('\n')));
test('sanitizeText: truncates at maxLen',      () => assert.strictEqual(sanitizeText('A'.repeat(1000), 100).length, 100));
test('sanitizeText: returns empty for null',   () => assert.strictEqual(sanitizeText(null), ''));
test('sanitizeText: handles numbers',          () => assert.strictEqual(sanitizeText(42), '42'));
test('sanitizeText: trims whitespace',         () => assert.strictEqual(sanitizeText('  hello  '), 'hello'));

// ─── severityLabel ────────────────────────────────────────────────────────────

test('severityLabel 1 = SEV1 - CRITICAL', () => assert.strictEqual(severityLabel(1), 'SEV1 - CRITICAL'));
test('severityLabel 2 = SEV2 - HIGH',     () => assert.strictEqual(severityLabel(2), 'SEV2 - HIGH'));
test('severityLabel 3 = SEV3 - MEDIUM',   () => assert.strictEqual(severityLabel(3), 'SEV3 - MEDIUM'));
test('severityLabel 4 = SEV4 - LOW',      () => assert.strictEqual(severityLabel(4), 'SEV4 - LOW'));
test('severityLabel unknown defaults',    () => assert.ok(severityLabel(99)));

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
