'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'skills/master-agreement-generator/scripts/build-agreement.js');
const templatePath = path.join(repoRoot, 'skills/master-agreement-generator/references/master-template.example.md');
const specPath = path.join(repoRoot, 'skills/master-agreement-generator/references/spec.example.json');
const builder = require(scriptPath);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

const template = fs.readFileSync(templatePath, 'utf8');
const exampleSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

console.log('\n=== build-agreement ===\n');

test('renders every placeholder from the example spec', () => {
  const output = builder.render(template, exampleSpec);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(output), 'placeholders remain');
  assert.match(output, /Acme Compute Ltd/);
  assert.match(output, /\*\*ACME COMPUTE LTD\*\*/);
  assert.match(output, /SOURCING FEE/);
  assert.match(output, /\| 1 \| 2026-08-20 \| Lot A \(16 nodes\) \| introducer \| 12 months \| standard \|/);
  assert.match(output, /the Data Processing Addendum dated 2026-09-01; amendable/);
});

test('renders the empty schedule placeholder row and blank lines when fields are omitted', () => {
  const output = builder.render(template, { file: 'X', short: 'Xco', role: 'buyer', date: 'January 1, 2030' });
  assert.ok(output.includes(builder.EMPTY_SCHEDULE_ROW));
  assert.match(output, new RegExp(`Name: ${builder.BLANK}`));
  assert.match(output, /\*\*XCO\*\*/);
  assert.match(output, /January 1, 2030/);
  assert.ok(!output.includes('; amendable') || output.includes('matter; amendable'), 'supplement separator must be empty');
});

test('selects the role clause by spec.role', () => {
  for (const role of ['buyer', 'supplier', 'mutual']) {
    const values = builder.buildValues({ file: 'X', short: 'Xco', role });
    assert.strictEqual(values.FEE_TITLE, builder.ROLE_CLAUSES[role].title);
    assert.ok(!values.ROLE_CLAUSE.includes('{cp}'), 'counterparty short name not substituted');
  }
  assert.match(builder.buildValues({ file: 'X', short: 'Xco', role: 'mutual' }).ROLE_CLAUSE, /Each Party may introduce/);
});

test('rejects unknown roles and missing required fields', () => {
  assert.throws(() => builder.buildValues({ file: 'X', short: 'Xco', role: 'partner' }), /unknown role "partner"/);
  assert.throws(() => builder.buildValues({ short: 'Xco', role: 'buyer' }), /spec\.file is required/);
});

test('build writes markdown and reports docx skipped when pandoc is unavailable', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-build-agreement-'));
  try {
    const result = builder.build(templatePath, specPath, outDir, { pandoc: false, now: new Date('2030-01-01T00:00:00Z') });
    assert.ok(fs.existsSync(result.markdown));
    assert.strictEqual(path.basename(result.markdown), 'AcmeSupplier MASTER.md');
    assert.strictEqual(result.docxSkipped, true);
    assert.strictEqual(result.docx, null);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('main returns usage exit code without arguments', () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.strictEqual(builder.main([]), 2);
  } finally {
    console.error = originalError;
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
