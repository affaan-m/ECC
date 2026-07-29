/**
 * Surface test for #2573: every GATEGUARD_* environment variable the hook
 * reads must be documented in the GateGuard skill doc.
 *
 * `GATEGUARD_BASH_ROUTINE_DISABLED` shipped with no documentation at all and
 * `GATEGUARD_EXEMPT_GLOBS` was mentioned only in a release note, so operators
 * had no discoverable way to narrow the gate short of disabling it outright.
 * This pins the surface: adding a knob to the hook without documenting it
 * fails here.
 *
 * Run with: node tests/ci/gateguard-env-documented.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const hookPath = path.join(repoRoot, 'scripts', 'hooks', 'gateguard-fact-force.js');
const skillPath = path.join(repoRoot, 'skills', 'gateguard', 'SKILL.md');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function readGateguardEnvNames(source) {
  // process.env.GATEGUARD_X and process.env['GATEGUARD_X']
  const dotted = source.match(/process\.env\.GATEGUARD_[A-Z0-9_]+/g) || [];
  const bracketed = source.match(/process\.env\[\s*['"]GATEGUARD_[A-Z0-9_]+['"]\s*\]/g) || [];
  const names = [...dotted, ...bracketed]
    .map(hit => (hit.match(/GATEGUARD_[A-Z0-9_]+/) || [])[0])
    .filter(Boolean);
  return new Set(names);
}

console.log('\nGateGuard env-var documentation surface\n');

if (test('hook and skill doc both exist', () => {
  assert.ok(fs.existsSync(hookPath), `missing ${hookPath}`);
  assert.ok(fs.existsSync(skillPath), `missing ${skillPath}`);
})) passed++; else failed++;

const hookSource = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : '';
const skillDoc = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : '';
const envNames = readGateguardEnvNames(hookSource);

if (test('hook reads at least one GATEGUARD_* variable', () => {
  assert.ok(envNames.size > 0, 'no GATEGUARD_* env reads found - has the hook moved?');
})) passed++; else failed++;

if (test('every GATEGUARD_* variable the hook reads is documented', () => {
  const undocumented = [...envNames].filter(name => !skillDoc.includes(name)).sort();
  assert.deepStrictEqual(
    undocumented,
    [],
    `undocumented in skills/gateguard/SKILL.md: ${undocumented.join(', ')}`
  );
})) passed++; else failed++;

if (test('the documented knobs are the ones the hook actually reads', () => {
  // Guards the reverse drift: a doc naming a knob the hook no longer reads.
  // Compared against the parsed env reads, not raw source — a name surviving
  // only in a comment or error string must not satisfy this.
  const documented = [...new Set(skillDoc.match(/GATEGUARD_[A-Z0-9_]+/g) || [])];
  const stale = documented.filter(name => !envNames.has(name)).sort();
  assert.deepStrictEqual(stale, [], `documented but unread by the hook: ${stale.join(', ')}`);
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}\n`);

if (failed > 0) {
  process.exit(1);
}
