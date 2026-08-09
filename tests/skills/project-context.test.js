'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'project-context', 'SKILL.md');

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

const skill = fs.readFileSync(skillPath, 'utf8');
const frontmatterMatch = skill.match(/^---\n([\s\S]*?)\n---/);

console.log('\n=== project-context skill tests ===\n');

test('has valid YAML frontmatter with name and description', () => {
  assert.ok(frontmatterMatch, 'SKILL.md must have YAML frontmatter');
  const fm = frontmatterMatch[1];
  assert.match(fm, /^name:\s*project-context/m, 'name must be project-context');
  assert.match(fm, /^description:/m, 'frontmatter must include description');
  assert.doesNotMatch(fm, /^description:\s*[|>]/m, 'description must be an inline scalar, not a block scalar');
});

test('has metadata origin field', () => {
  assert.ok(frontmatterMatch, 'SKILL.md must have YAML frontmatter');
  assert.match(frontmatterMatch[1], /origin:\s*(ECC|community)/);
});

test('specifies PROJECT-CONTEXT.md as the output file at the project root', () => {
  assert.match(skill, /PROJECT-CONTEXT\.md/);
  assert.match(skill, /project root/i);
});

test('documents all required sections of the context file', () => {
  assert.match(skill, /What This Is/i);
  assert.match(skill, /Current State/i);
  assert.match(skill, /Architecture/i);
  assert.match(skill, /Active Constraints/i);
  assert.match(skill, /Accepted Decisions/i);
  assert.match(skill, /Open Questions/i);
  assert.match(skill, /Agent Instructions/i);
});

test('enforces a size limit to keep the file scannable', () => {
  assert.match(skill, /100 lines|under.*lines/i);
});

test('has When to Activate and When NOT to Activate sections', () => {
  assert.match(skill, /## When to Activate/);
  assert.match(skill, /## When NOT to Activate/);
});

test('explains how to load PROJECT-CONTEXT.md into subagent prompts', () => {
  assert.match(skill, /subagent/i);
  assert.match(skill, /Project context.*read before responding/is);
});

test('describes the creation workflow including user review before commit', () => {
  assert.match(skill, /workflow/i);
  assert.match(skill, /Creating the file/i);
  assert.match(skill, /user/i);
});

test('describes when to update the file', () => {
  assert.match(skill, /Updating the file/i);
  assert.match(skill, /update.*when|when.*update/i);
});

test('prohibits inventing decisions not actually made', () => {
  assert.match(skill, /Do not invent/i);
  assert.match(skill, /Open Questions/i);
});

test('has quality checklist before committing', () => {
  assert.match(skill, /Quality Checks/i);
  assert.match(skill, /\[ \]/);
});

test('has Anti-Patterns section warning about staleness', () => {
  assert.match(skill, /## Anti-Patterns/);
  assert.match(skill, /stale/i);
});

test('cross-references dev-team and story-lifecycle', () => {
  assert.match(skill, /dev-team/);
  assert.match(skill, /story-lifecycle/);
});

test('cross-references architecture-decision-records', () => {
  assert.match(skill, /architecture-decision-records/);
});

test('has a concrete example with realistic project content', () => {
  assert.match(skill, /## Example/);
  assert.match(skill, /Last updated/i);
  assert.match(skill, /Status.*active|active.*Status/i);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
