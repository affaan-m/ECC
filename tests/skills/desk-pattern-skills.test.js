'use strict';

/**
 * Contract tests for the generic desk-pattern skills: operator approval loop,
 * counterparty channel discipline, master agreement generator, and e-sign
 * field placement. They must stay vendor-neutral and free of local paths.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const SKILLS = [
  'operator-approval-loop',
  'counterparty-channel-discipline',
  'master-agreement-generator',
  'esign-field-placement',
];
const REQUIRED_SECTIONS = ['## When to Use', '## How It Works', '## Examples'];
const FORBIDDEN_WORDS = [
  'ito', 'itô', 'hermes', 'docusign', 'pluto', 'stellon', 'mayfield',
  'affaan', 'alejandro', 'graphiti', 'itomarkets',
];
const EM_DASH = '—';

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

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

console.log('\n=== Desk pattern skills ===\n');

for (const skill of SKILLS) {
  const skillDir = path.join(repoRoot, 'skills', skill);
  const skillPath = path.join(skillDir, 'SKILL.md');

  test(`${skill}: SKILL.md has name and description frontmatter`, () => {
    assert.ok(fs.existsSync(skillPath), `${skill}/SKILL.md is missing`);
    const source = fs.readFileSync(skillPath, 'utf8');
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, 'frontmatter missing');
    const keys = frontmatter[1].split('\n').map(line => line.split(':')[0]);
    assert.deepStrictEqual(keys, ['name', 'description']);
    assert.match(frontmatter[1], new RegExp(`^name: ${skill}$`, 'm'));
    assert.match(frontmatter[1], /^description: .*Use when/m);
  });

  test(`${skill}: SKILL.md has the required sections`, () => {
    const source = fs.readFileSync(skillPath, 'utf8');
    for (const section of REQUIRED_SECTIONS) {
      assert.ok(source.includes(section), `missing ${section}`);
    }
  });

  test(`${skill}: files contain no em dashes, vendor names, or local paths`, () => {
    for (const file of walk(skillDir)) {
      const relative = path.relative(repoRoot, file);
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(!source.includes(EM_DASH), `${relative} contains an em dash`);
      assert.ok(!/\/Users\//.test(source), `${relative} contains a /Users/ path`);
      for (const word of FORBIDDEN_WORDS) {
        const pattern = new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i');
        assert.ok(!pattern.test(source), `${relative} mentions "${word}"`);
      }
    }
  });
}

test('operator-approval-loop ships the ledger schema with the idempotency key', () => {
  const sql = fs.readFileSync(path.join(repoRoot, 'skills/operator-approval-loop/references/approval-ledger.sql'), 'utf8');
  assert.match(sql, /UNIQUE\(obligation_id, decision_id\)/);
  assert.match(sql, /draft_sha256/);
  assert.match(sql, /auto_send_after/);
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/operator-approval-loop/SKILL.md'), 'utf8');
  assert.match(skill, /BASELINE_CHECK_UNAVAILABLE/);
  assert.match(skill, /exact `draft_text`/);
});

test('counterparty-channel-discipline ships a policy example and a strict prompt template', () => {
  const policy = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/channel-policy.example.yaml'), 'utf8');
  assert.match(policy, /require_mention: true/);
  assert.match(policy, /observe_unmentioned_group_messages: true/);
  assert.match(policy, /default: auto/);
  const template = fs.readFileSync(path.join(repoRoot, 'skills/counterparty-channel-discipline/references/strict-prompt.template.md'), 'utf8');
  assert.match(template, /\{\{CHANNEL_NAME\}\}/);
  assert.match(template, /Never reveal one counterparty/);
});

test('master-agreement-generator template pins the signature page with a page break', () => {
  const template = fs.readFileSync(path.join(repoRoot, 'skills/master-agreement-generator/references/master-template.example.md'), 'utf8');
  assert.match(template, /w:br w:type="page"/);
  assert.match(template, /\{\{SCHEDULE_ROWS\}\}/);
  const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'skills/master-agreement-generator/references/spec.example.json'), 'utf8'));
  assert.strictEqual(spec.role, 'supplier');
});

test('esign-field-placement defaults to draft and forbids credential entry', () => {
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/esign-field-placement/SKILL.md'), 'utf8');
  assert.match(skill, /save as draft/i);
  assert.match(skill, /never\s+enters credentials/i);
  assert.match(skill, /Never nudge by drag/);
  assert.match(skill, /LOGGED OUT/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
