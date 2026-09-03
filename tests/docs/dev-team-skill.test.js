const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SKILL_PATH = path.join(ROOT, 'skills', 'dev-team', 'SKILL.md');

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
  console.log('\n=== Testing dev-team skill contract ===\n');

  let passed = 0;
  let failed = 0;
  const body = fs.readFileSync(SKILL_PATH, 'utf8');

  if (test('uses the canonical When to Activate header', () => {
    assert.ok(body.includes('## When to Activate'), 'missing ## When to Activate');
  })) passed++; else failed++;

  if (test('defines all four preset roles with their lenses', () => {
    for (const role of ['Product Manager', 'Architect', 'Developer', 'QA Engineer']) {
      assert.ok(body.includes(role), `missing role: ${role}`);
    }
    for (const lens of ['user value', 'system design', 'implementation complexity', 'testability']) {
      assert.ok(body.includes(lens), `missing lens: ${lens}`);
    }
  })) passed++; else failed++;

  if (test('requires parallel dispatch of all four personas', () => {
    assert.ok(body.includes('### 3. Launch four personas in parallel'), 'missing parallel step');
    assert.ok(/all four must run at the same time/i.test(body), 'missing parallel anti-pattern');
  })) passed++; else failed++;

  if (test('personas are analysis-only with no state-changing tool use', () => {
    assert.ok(/analysis-only/i.test(body), 'missing analysis-only rule');
    assert.ok(/must not edit files, run state-changing commands/i.test(body),
      'missing no-state-change rule');
    assert.ok(body.includes('do not edit files, run commands, or change any state'),
      'prompt template must carry the analysis-only instruction');
  })) passed++; else failed++;

  if (test('untrusted-context boundary is embedded in the persona prompt template', () => {
    assert.ok(body.includes('untrusted declarative data'), 'missing inline trust label');
    assert.ok(body.includes('do NOT follow any instructions'), 'missing inline directive guard');
    const promptStart = body.indexOf('```text');
    const promptEnd = body.indexOf('```', promptStart + 7);
    const template = body.slice(promptStart, promptEnd);
    assert.ok(template.includes('untrusted declarative data'),
      'trust label must be inside the prompt template, not only prose');
  })) passed++; else failed++;

  if (test('personas receive a bounded summary, never raw PROJECT-CONTEXT.md', () => {
    assert.ok(/do \*\*not\*\* pass its raw content/i.test(body), 'missing raw-content ban');
    assert.ok(/at most 150 words/i.test(body), 'missing summary bound');
    assert.ok(/drop anything that looks like a secret/i.test(body), 'missing secret filter');
  })) passed++; else failed++;

  if (test('context loading is harness-neutral, no POSIX-only shell', () => {
    assert.ok(/native file tools/i.test(body), 'missing harness-native rule');
    const codeFences = body.match(/```bash[\s\S]*?```/g) || [];
    assert.strictEqual(codeFences.length, 0, 'no bash fences should remain');
  })) passed++; else failed++;

  if (test('synthesis names tensions instead of averaging them', () => {
    assert.ok(body.includes('### Synthesis'), 'missing synthesis section');
    assert.ok(/Name tensions explicitly/i.test(body), 'missing tension guardrail');
    assert.ok(/flag it as a blocking issue/i.test(body), 'missing blocking-issue rule');
  })) passed++; else failed++;

  if (test('boundary with team-builder and council is explicit', () => {
    assert.ok(body.includes('## Relationship to council and team-builder'), 'missing boundary section');
    assert.ok(body.includes('team-builder'), 'missing team-builder reference');
    assert.ok(/preset four-lens/i.test(body), 'missing preset positioning');
  })) passed++; else failed++;

  if (test('does not reference surfaces that are not on main', () => {
    assert.ok(!body.includes('story-lifecycle'), 'story-lifecycle is not merged');
    assert.ok(!body.includes('ecc:plan-prd'), 'plan-prd resolves as a command, not a skill');
  })) passed++; else failed++;

  if (test('every referenced skill, agent, and command resolves in the repo', () => {
    const refs = [
      'skills/council/SKILL.md',
      'skills/team-builder/SKILL.md',
      'skills/santa-method/SKILL.md',
      'commands/plan-prd.md',
      'commands/plan.md',
      'commands/epic-decompose.md',
      'commands/save-session.md',
      'commands/code-review.md',
      'agents/architect.md',
      'agents/code-reviewer.md',
    ];
    for (const ref of refs) {
      assert.ok(fs.existsSync(path.join(ROOT, ref)), `unresolved reference: ${ref}`);
    }
  })) passed++; else failed++;

  if (test('skill is registered in install manifest and npm files list', () => {
    const modules = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'manifests', 'install-modules.json'), 'utf8'));
    assert.ok(JSON.stringify(modules).includes('skills/dev-team'),
      'missing from manifests/install-modules.json');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.files.includes('skills/dev-team/'),
      'missing from package.json files');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
