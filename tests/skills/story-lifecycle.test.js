'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'story-lifecycle', 'SKILL.md');

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

console.log('\n=== story-lifecycle skill tests ===\n');

test('has valid YAML frontmatter with name and description', () => {
  assert.ok(frontmatterMatch, 'SKILL.md must have YAML frontmatter');
  const fm = frontmatterMatch[1];
  assert.match(fm, /^name:\s*story-lifecycle/m, 'name must be story-lifecycle');
  assert.match(fm, /^description:/m, 'frontmatter must include description');
  assert.doesNotMatch(fm, /^description:\s*[|>]/m, 'description must be an inline scalar, not a block scalar');
});

test('has metadata origin field', () => {
  assert.ok(frontmatterMatch, 'SKILL.md must have YAML frontmatter');
  assert.match(frontmatterMatch[1], /origin:\s*(ECC|community)/);
});

test('specifies .delivery/ as the file layout root', () => {
  assert.match(skill, /\.delivery\//);
  assert.match(skill, /epics\//i);
  assert.match(skill, /stories\//i);
  assert.match(skill, /sprints\//i);
});

test('uses EPIC-NNN, STORY-NNN, SPRINT-NN naming conventions', () => {
  assert.match(skill, /EPIC-NNN/);
  assert.match(skill, /STORY-NNN/);
  assert.match(skill, /SPRINT-NN/);
});

test('documents epic file format with required fields', () => {
  assert.match(skill, /### Epic/);
  assert.match(skill, /\*\*Status\*\*/);
  assert.match(skill, /\*\*Owner\*\*/);
  assert.match(skill, /\*\*Goal\*\*/);
  assert.match(skill, /\*\*Success metric\*\*/);
});

test('documents story file format with user story and acceptance criteria', () => {
  assert.match(skill, /### Story/);
  assert.match(skill, /## User Story/);
  assert.match(skill, /As a.*I want.*so that/is);
  assert.match(skill, /## Acceptance Criteria/);
});

test('defines story status states including blocked', () => {
  assert.match(skill, /backlog/i);
  assert.match(skill, /in-progress/i);
  assert.match(skill, /review/i);
  assert.match(skill, /done/i);
  assert.match(skill, /blocked/i);
});

test('enforces XL stories must be split before entering a sprint', () => {
  assert.match(skill, /XL/);
  assert.match(skill, /split/i);
  assert.match(skill, /sprint/i);
});

test('documents size estimates S, M, L, XL', () => {
  assert.match(skill, /\bS\b.*\bM\b.*\bL\b.*\bXL\b|\bS \(|M \(|L \(/);
  assert.match(skill, /half day|1-2 days|3-5 days/i);
});

test('documents sprint file format with goal and story table', () => {
  assert.match(skill, /### Sprint/);
  assert.match(skill, /\*\*Goal\*\*/);
  assert.match(skill, /\*\*Start\*\*/);
  assert.match(skill, /\*\*End\*\*/);
  assert.match(skill, /## Stories/);
});

test('has five named workflow phases from epic to sprint close', () => {
  assert.match(skill, /Phase 1.*Epic from intent/i);
  assert.match(skill, /Phase 2.*Story decomposition/i);
  assert.match(skill, /Phase 3.*Sprint planning/i);
  assert.match(skill, /Phase 4.*Execution/i);
  assert.match(skill, /Phase 5.*Sprint close/i);
});

test('instructs agents to read PROJECT-CONTEXT.md before working a story', () => {
  assert.match(skill, /PROJECT-CONTEXT\.md/);
  assert.match(skill, /project.context/i);
});

test('instructs agents to use tdd-workflow for implementation', () => {
  assert.match(skill, /tdd-workflow/);
});

test('requires acceptance criteria to be concrete and testable, not vague', () => {
  assert.match(skill, /concrete.*testable|testable.*concrete/i);
  assert.match(skill, /not vague|rather than vague|not a.*list/i);
});

test('has Anti-Patterns section', () => {
  assert.match(skill, /## Anti-Patterns/);
  assert.match(skill, /XL.*sprint|sprint.*XL/i);
  assert.match(skill, /stale/i);
});

test('cross-references project-context, dev-team, and architecture-decision-records', () => {
  assert.match(skill, /project-context/);
  assert.match(skill, /dev-team/);
  assert.match(skill, /architecture-decision-records/);
});

test('has a concrete example with epic, stories, and sprint goal', () => {
  assert.match(skill, /## Example/);
  assert.match(skill, /EPIC-001/);
  assert.match(skill, /STORY-00[123]/);
  assert.match(skill, /SPRINT-01 goal/i);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
