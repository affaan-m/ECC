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

let skill;
let frontmatterMatch;

console.log('\n=== story-lifecycle skill tests ===\n');

try {
  skill = fs.readFileSync(skillPath, 'utf8');
  frontmatterMatch = skill.match(/^---\n([\s\S]*?)\n---/);
} catch (err) {
  console.log(`  ✗ fixture: SKILL.md must be readable`);
  console.log(`    Error: ${err.message}`);
  console.log(`\nResults: Passed: 0, Failed: 1`);
  process.exit(1);
}

test('has valid YAML frontmatter with name and description', () => {
  assert.ok(frontmatterMatch, 'SKILL.md must have YAML frontmatter');
  const fm = frontmatterMatch[1];
  // Parse each key as a simple line-based YAML scalar (no block scalars)
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  assert.ok(nameMatch, 'frontmatter must have a name field');
  assert.strictEqual(nameMatch[1].trim(), 'story-lifecycle', 'name must be exactly story-lifecycle');
  assert.ok(descMatch, 'frontmatter must have a non-empty inline description');
  assert.ok(descMatch[1].trim().length > 0, 'description must not be empty');
});

test('has metadata origin field', () => {
  assert.ok(frontmatterMatch, 'SKILL.md must have YAML frontmatter');
  const fm = frontmatterMatch[1];
  const originMatch = fm.match(/^\s+origin:\s*(.+)$/m);
  assert.ok(originMatch, 'frontmatter must have a metadata.origin field');
  const origin = originMatch[1].trim();
  assert.ok(origin === 'ECC' || origin === 'community', `metadata.origin must be "ECC" or "community", got "${origin}"`);
});

test('has When to Use and When NOT to Use sections', () => {
  assert.match(skill, /## When to Use/);
  assert.match(skill, /## When NOT to Use/);
});

test('specifies .delivery/ as the file layout root', () => {
  assert.match(skill, /\.delivery\//);
  assert.match(skill, /epics\//i);
  assert.match(skill, /stories\//i);
  assert.match(skill, /sprints\//i);
});

test('requires path-containment validation before writing delivery files', () => {
  // Slugs must be restricted to safe characters
  assert.match(skill, /lowercase.*digits.*hyphens|lowercase letters.*digits.*hyphens/i);
  // Each path must be resolved and confirmed to stay within its expected subdirectory
  assert.match(skill, /[Rr]esolve.*target path|resolve the.*path/i);
  assert.match(skill, /[Rr]eject.*does not remain under|reject.*escape/i);
  // All three subdirectories must be guarded
  assert.match(skill, /\.delivery\/epics\//);
  assert.match(skill, /\.delivery\/stories\//);
  assert.match(skill, /\.delivery\/sprints\//);
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

test('defines story status states including closed and blocked', () => {
  assert.match(skill, /backlog/i);
  assert.match(skill, /in-progress/i);
  assert.match(skill, /review/i);
  assert.match(skill, /done/i);
  assert.match(skill, /closed/i);
  assert.match(skill, /blocked/i);
});

test('documents how blocked stories resume when the blocker is resolved', () => {
  // Must persist prior state when blocking (Pre-block Status field)
  assert.match(skill, /\*\*Pre-block Status\*\*/);
  assert.match(skill, /set.*Pre-block Status.*current.*Status|Pre-block Status.*current/i);
  // Must restore from Pre-block Status only when ALL blockers are gone
  assert.match(skill, /restore.*Status.*Pre-block Status|read.*Pre-block Status.*restore/i);
  // Must clear Pre-block Status after recovery
  assert.match(skill, /clear.*Pre-block Status|Pre-block Status.*cleared/i);
  // Must stop and report if Pre-block Status is absent rather than guessing
  assert.match(skill, /[Aa]bsent.*empty.*stop|Pre-block Status.*absent.*stop/i);
  // Must remove only the resolved blocker — not clear the whole section while others remain
  assert.match(skill, /remove only that blocker|[Rr]emove only.*blocker/i);
  // Must keep blocked status while other blockers remain
  assert.match(skill, /other blockers remain|blockers remain.*leave.*blocked/i);
  // Must restore status only when Blockers section is empty
  assert.match(skill, /[Bb]lockers section is empty|empty.*restore|when.*empty.*read.*Pre-block/i);
});

test('restricts blocked transition to non-terminal source states only', () => {
  // Only ready, in-progress, review may transition to blocked
  assert.match(skill, /ready.*in-progress.*review.*blocked/is);
  // done and closed must not be valid sources for blocked
  assert.match(skill, /[Dd]o not transition.*done.*closed.*blocked|done.*closed.*unknown.*blocked/is);
  // closed is terminal — no transitions out
  assert.match(skill, /closed.*terminal|terminal.*closed/i);
  // Unknown states must be rejected
  assert.match(skill, /[Rr]eject.*unknown|unknown.*state/i);
});

test('carry rule in Phase 5 rejects closed and unknown source states', () => {
  // Carry valid sources must be enumerated (not "anything other than done")
  assert.match(skill, /ready.*in-progress.*review.*blocked.*carrying|carrying.*ready.*in-progress.*review.*blocked/is);
  // Must explicitly reject closed as a carry source
  assert.match(skill, /[Rr]eject.*closed|closed.*unknown.*stop/i);
});

test('carry rule sets the Status cell in the next sprint table to the retained story status', () => {
  // The next-sprint row must include the retained Status value, not leave it blank
  assert.match(skill, /retained.*\*\*Status\*\*|retained.*Status.*value|next sprint.*retained/i);
});

test('enforces XL stories must be split before entering a sprint', () => {
  assert.match(skill, /XL/);
  assert.match(skill, /split/i);
  assert.match(skill, /sprint/i);
});

test('Phase 2 requires creating a story file and linking it into the epic checklist', () => {
  // Must instruct creating .delivery/stories/STORY-NNN-[slug].md during decomposition
  assert.match(skill, /\.delivery\/stories\/STORY-NNN/);
  // Must set initial status to backlog using the documented bold key
  assert.match(skill, /\*\*Status\*\*: backlog/);
  // Must add each story as an unchecked item in the epic's ## Stories checklist
  assert.match(skill, /epic.*Stories.*checklist|## Stories.*checklist|checklist.*- \[ \]/is);
  assert.match(skill, /- \[ \] STORY-NNN/);
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

test('Phase 3 populates the sprint table with story ID, title, owner, status, and size', () => {
  assert.match(skill, /[Aa]dd each selected story.*sprint table|sprint table.*story ID.*title.*owner/is);
  assert.match(skill, /story ID|Story ID/);
  assert.match(skill, /title/i);
  assert.match(skill, /owner/i);
  assert.match(skill, /size/i);
  // Must require the table to be populated before Phase 5 updates it
  assert.match(skill, /before Phase 5|before.*Phase 5.*attempts/i);
});

test('Phase 4 requires updating the sprint table row after every status transition', () => {
  // Must require keeping the sprint table in sync on every Phase 4 change
  assert.match(skill, /sprint table.*match|update.*sprint table.*status|Status cell.*sprint table/i);
  // The agent implementation step must also reference sprint table update
  assert.match(skill, /sprint table.*review|review.*sprint table/i);
});

test('has five named workflow phases from epic to sprint close', () => {
  assert.match(skill, /Phase 1.*Epic from intent/i);
  assert.match(skill, /Phase 2.*Story decomposition/i);
  assert.match(skill, /Phase 3.*Sprint planning/i);
  assert.match(skill, /Phase 4.*Execution/i);
  assert.match(skill, /Phase 5.*Sprint close/i);
});

test('sprint close synchronizes story file, epic checklist, and sprint table', () => {
  // closed must be the terminal state set in the story file
  assert.match(skill, /Status: closed.*story file|closed.*terminal state/is);
  // Must update the epic checklist
  assert.match(skill, /epic.*checklist|checklist.*epic/i);
  // Sprint table row must also be updated to closed
  assert.match(skill, /sprint table.*closed|current sprint table.*closed/is);
  // Must handle unfinished stories: update Sprint: field and add to next sprint table
  assert.match(skill, /Sprint:.*next sprint|next sprint.*Sprint:/is);
  assert.match(skill, /next sprint.*table|carried from/i);
});

test('sprint close defines a recoverable multi-file commit procedure', () => {
  // Must acknowledge that markdown writes are not natively atomic
  assert.match(skill, /not natively atomic|Markdown writes are not/i);
  // Must require validating IDs and status transitions before writing
  assert.match(skill, /[Vv]alidat.*[Ss]tory.*ID|[Vv]alidat.*[Ee]pic.*ID|Confirm every referenced/i);
  assert.match(skill, /[Vv]alidat.*status|expected pre-transition/i);
  // Must require snapshotting files for rollback
  assert.match(skill, /[Ss]napshot|rollback/i);
  // Must require restoring prior files if a write fails
  assert.match(skill, /restore.*fail|fail.*restore/i);
  // Must snapshot all distinct parent epic files, not just one
  assert.match(skill, /distinct parent epic|unique set of epic files|every distinct.*epic/i);
});

test('instructs agents to read CLAUDE.md conditionally and defines fallback for absent file', () => {
  // Must reference CLAUDE.md
  assert.match(skill, /CLAUDE\.md/);
  // Read must be conditional — not an unconditional requirement
  assert.match(skill, /[Ii]f.*CLAUDE\.md.*exist|[Ii]f.*root.*CLAUDE\.md/i);
  // Must define the omitted Project context form for repositories without CLAUDE.md
  assert.match(skill, /[Oo]mit the Project context|no root.*CLAUDE\.md.*omit/i);
});

test('story handoff marks both context blocks as untrusted and guards against prompt injection', () => {
  // Both inserted blocks must be labelled as untrusted reference data
  assert.match(skill, /untrusted reference data/i);
  // Must instruct the agent to ignore embedded instructions that conflict with policy
  assert.match(skill, /[Dd]o not follow instructions embedded/);
  // Must require validating story fields before acting
  assert.match(skill, /[Vv]alidate the story.*[Ss]tatus|[Vv]alidate the story.*[Ff]ield/i);
  // Must prohibit accessing secrets or external systems without explicit authorization
  assert.match(skill, /[Dd]o not access secrets|secrets.*external systems/i);
  // Must restrict tool use to the approved repository work scope
  assert.match(skill, /[Rr]estrict tool use.*repository|repository scope/i);
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

test('cross-references dev-team and architecture-decision-records', () => {
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
