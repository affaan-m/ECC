'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const repoRoot = path.join(__dirname, '..', '..');
const skillRoot = path.join(repoRoot, 'skills', 'sandbox-testing');
const skillPath = path.join(skillRoot, 'SKILL.md');
const metadataPath = path.join(skillRoot, 'agents', 'openai.yaml');
const guidePath = path.join(repoRoot, 'docs', 'sandbox-testing.md');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}\n    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

console.log('\n=== Sandbox testing Tier 1 agent surface ===\n');

test('skill has strict frontmatter and a focused Tier 0 and Tier 1 scope', () => {
  const source = fs.readFileSync(skillPath, 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match);
  const frontmatter = yaml.load(match[1]);
  assert.deepStrictEqual(Object.keys(frontmatter).sort(), ['description', 'name']);
  assert.strictEqual(frontmatter.name, 'sandbox-testing');
  assert.match(source, /Tier 0.*SRT/s);
  assert.match(source, /Tier 1.*rootless Podman/s);
  assert.doesNotMatch(source, /Tier 2|Lume|execution fabric|fabric controller/i);
});

test('agent workflow requires the exact consent-bound user prompt', () => {
  const source = fs.readFileSync(skillPath, 'utf8');
  assert.match(source, /consent-required/);
  assert.match(source, /creates_run: false/);
  assert.match(source, /repeat the returned prompt verbatim/i);
  assert.match(source, /Would you like to launch a Tier 1 rootless Podman sandbox[\s\S]*\? y\/n/);
  assert.match(source, /--consent y --proposal/);
  assert.match(source, /Do not provision.*explicit `y`/i);
});

test('manual loop supports both terminals and outside-agent monitoring', () => {
  const source = fs.readFileSync(skillPath, 'utf8');
  assert.match(source, /--terminal wezterm/);
  assert.match(source, /--terminal terminal\.app/);
  assert.match(source, /run commands[\s\S]*launch an available agent/i);
  assert.match(source, /ecc-sandbox listen RUN_ID --follow --format jsonl/);
  assert.match(source, /Manual exploration is explicitly non-evidence/);
});

test('user guide keeps Podman and evidence boundaries explicit', () => {
  const guide = fs.readFileSync(guidePath, 'utf8');
  assert.match(guide, /Docker is not a Tier 1 fallback/);
  assert.match(guide, /source checkout is available[\s\S]*read-only/i);
  assert.match(guide, /agent can use[\s\S]*modify the feature outside the sandbox/i);
  assert.match(guide, /Manual exploration is non-evidence/);
  assert.doesNotMatch(guide, /Tier 2|Lume|execution fabric|fabric controller/i);
});

test('OpenAI metadata names the skill without adding hidden workflow claims', () => {
  const metadata = yaml.load(fs.readFileSync(metadataPath, 'utf8'));
  assert.strictEqual(metadata.interface.display_name, 'Sandbox Testing');
  assert.match(metadata.interface.default_prompt, /\$sandbox-testing/);
  assert.match(metadata.interface.default_prompt, /rootless Podman/);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
