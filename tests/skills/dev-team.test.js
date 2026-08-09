'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'dev-team', 'SKILL.md');

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

console.log('\n=== dev-team skill tests ===\n');

test('has valid YAML frontmatter with name and description', () => {
  assert.ok(frontmatterMatch, 'SKILL.md must have YAML frontmatter');
  const fm = frontmatterMatch[1];
  assert.match(fm, /^name:\s*dev-team/m, 'name must be dev-team');
  assert.match(fm, /^description:/m, 'frontmatter must include description');
  assert.doesNotMatch(fm, /^description:\s*[|>]/m, 'description must be an inline scalar, not a block scalar');
});

test('has metadata origin field', () => {
  assert.ok(frontmatterMatch, 'SKILL.md must have YAML frontmatter');
  assert.match(frontmatterMatch[1], /origin:\s*(ECC|community)/);
});

test('declares all four roles: PM, Architect, Developer, QA', () => {
  assert.match(skill, /\bPM\b/);
  assert.match(skill, /\bArchitect\b/);
  assert.match(skill, /\bDeveloper\b/);
  assert.match(skill, /\bQA\b/);
});

test('has When to Activate and When NOT to Activate sections', () => {
  assert.match(skill, /## When to Activate/);
  assert.match(skill, /## When NOT to Activate/);
});

test('redirects code review to code-reviewer, not dev-team', () => {
  assert.match(skill, /code-reviewer/);
  assert.match(skill, /code review.*code-reviewer|code-reviewer.*code review/is);
});

test('describes parallel subagent launch pattern', () => {
  assert.match(skill, /parallel/i);
  assert.match(skill, /subagent/i);
  assert.match(skill, /independent/i);
});

test('documents the prompt shape for subagents', () => {
  assert.match(skill, /Prompt shape/i);
  assert.match(skill, /\[ROLE\]/);
  assert.match(skill, /Take/i);
  assert.match(skill, /Concerns/i);
  assert.match(skill, /Asks/i);
  assert.match(skill, /Definition of done/i);
});

test('has a synthesis step that explicitly surfaces conflicts', () => {
  assert.match(skill, /conflict/i);
  assert.match(skill, /synthesize|synthesis/i);
  // Must instruct the agent to surface disagreements, not bury them
  assert.match(skill, /Surface all disagreements|Do not hide conflicts|make.*disagreements visible/i);
});

test('documents the output format with Team Read section', () => {
  assert.match(skill, /Team Read/);
  assert.match(skill, /Alignment/);
  assert.match(skill, /Conflict/);
  assert.match(skill, /First action/i);
});

test('has Anti-Patterns section', () => {
  assert.match(skill, /## Anti-Patterns/);
  assert.match(skill, /anti-pattern/i);
});

test('cross-references project-context and story-lifecycle', () => {
  assert.match(skill, /project-context/);
  assert.match(skill, /story-lifecycle/);
});

test('cross-references council for strategic decisions', () => {
  assert.match(skill, /council/);
});

test('has a concrete example', () => {
  assert.match(skill, /## Example/);
  assert.match(skill, /rate limit/i);
});

test('warns against feeding full conversation history to subagents', () => {
  assert.match(skill, /conversation history/i);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
