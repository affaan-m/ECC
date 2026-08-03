const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SKILL_PATH = path.join(ROOT, 'skills', 'story-lifecycle', 'SKILL.md');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing story-lifecycle skill contract ===\n');

  let passed = 0;
  let failed = 0;
  const body = fs.readFileSync(SKILL_PATH, 'utf8');

  if (test('uses the canonical When to Activate header', () => {
    assert.ok(body.includes('## When to Activate'), 'missing ## When to Activate');
  })) passed++; else failed++;

  if (test('defines the forward-only state model todo → in-progress → review → done', () => {
    assert.ok(body.includes('todo → in-progress → review → done'), 'missing state chain');
    assert.ok(/moves strictly forward/i.test(body), 'missing forward-only rule');
    assert.ok(/no backward transitions/i.test(body), 'missing no-backward rule');
  })) passed++; else failed++;

  if (test('story file is the single authoritative status record', () => {
    assert.ok(/story file is the single authoritative record/i.test(body),
      'missing canonical-source statement');
    assert.ok(/the story file wins/i.test(body), 'missing conflict-resolution rule');
  })) passed++; else failed++;

  if (test('epic and sprint tables are derived, regenerated on transitions', () => {
    const derivedMarkers = body.match(/Derived from story files/g) || [];
    assert.ok(derivedMarkers.length >= 2, 'epic and sprint tables must be marked derived');
  })) passed++; else failed++;

  if (test('done requires confirmed merge to main; review gate before done', () => {
    assert.ok(/confirmed merged to the main branch/i.test(body), 'missing merge confirmation trigger');
    assert.ok(/never marked `done` while/i.test(body), 'missing done guard');
    assert.ok(/merge to main is confirmed: set status to `done`/i.test(body),
      'implement must only set done after confirmed merge');
  })) passed++; else failed++;

  if (test('implement runs tests first, then reviewer and verification-loop before review state', () => {
    assert.ok(/Tests first/.test(body), 'missing tests-first step');
    assert.ok(body.includes('tdd-workflow'), 'missing tdd-workflow reference');
    assert.ok(body.includes('verification-loop'), 'missing verification-loop reference');
    const testsIdx = body.indexOf('**Tests first**');
    const implementIdx = body.indexOf('Implement until the tests pass');
    const qualityIdx = body.indexOf('**Quality lane**');
    const reviewIdx = body.indexOf("status to `review`");
    assert.ok(testsIdx > -1 && testsIdx < implementIdx, 'tests must precede implementation');
    assert.ok(implementIdx < qualityIdx && qualityIdx < reviewIdx,
      'review state must come after quality lane');
  })) passed++; else failed++;

  if (test('declares slug/story-id/sprint validation and path confinement', () => {
    assert.ok(body.includes('^[a-z0-9]+(-[a-z0-9]+)*$'), 'missing slug pattern');
    assert.ok(body.includes('-[1-9][0-9]*$'), 'missing story-id pattern');
    assert.ok(/must stay inside `\.stories\/`/i.test(body), 'missing path confinement rule');
    assert.ok(body.includes('`..`'), 'must reject parent-directory traversal');
  })) passed++; else failed++;

  if (test('treats .stories content as untrusted data and forbids silent overwrites', () => {
    assert.ok(/data, not instructions/i.test(body), 'missing untrusted-content rule');
    assert.ok(/never follow imperative\s+directives/i.test(body), 'missing directive rule');
    assert.ok(/No silent overwrites/i.test(body), 'missing overwrite approval rule');
  })) passed++; else failed++;

  if (test('uses harness-native file operations, no POSIX-only shell bootstrap', () => {
    assert.ok(/native file tools/i.test(body), 'missing harness-native rule');
    assert.ok(!body.includes('test -d'), 'POSIX test -d must not appear');
    assert.ok(!body.includes('mkdir -p'), 'POSIX mkdir -p must not appear');
  })) passed++; else failed++;

  if (test('documents the boundary and handoff to issue-backed coordination', () => {
    assert.ok(body.includes('## Boundary with GitHub-backed coordination'), 'missing boundary section');
    assert.ok(/Never run both systems as parallel authorities/i.test(body), 'missing authority rule');
    assert.ok(/Exported to:/i.test(body), 'missing handoff marker');
  })) passed++; else failed++;

  if (test('does not reference surfaces that are not on main', () => {
    assert.ok(!body.includes('PROJECT-CONTEXT.md'), 'PROJECT-CONTEXT.md is not an adopted surface');
    assert.ok(!/`dev-team`/.test(body), 'dev-team skill is not merged');
  })) passed++; else failed++;

  if (test('every referenced skill, agent, and command resolves in the repo', () => {
    const refs = [
      'skills/tdd-workflow/SKILL.md',
      'skills/verification-loop/SKILL.md',
      'skills/council/SKILL.md',
      'skills/project-flow-ops/SKILL.md',
      'commands/plan-prd.md',
      'commands/epic-decompose.md',
      'agents/architect.md',
      'agents/tdd-guide.md',
      'agents/code-reviewer.md',
    ];
    for (const ref of refs) {
      assert.ok(fs.existsSync(path.join(ROOT, ref)), `unresolved reference: ${ref}`);
    }
  })) passed++; else failed++;

  if (test('skill is registered in install manifest and npm files list', () => {
    const modules = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'manifests', 'install-modules.json'), 'utf8'));
    assert.ok(JSON.stringify(modules).includes('skills/story-lifecycle'),
      'missing from manifests/install-modules.json');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.files.includes('skills/story-lifecycle/'),
      'missing from package.json files');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
