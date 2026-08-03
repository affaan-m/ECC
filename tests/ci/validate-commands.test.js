/**
 * Tests for validate-commands.js — command frontmatter and reference validation.
 *
 * Split from the original monolithic tests/ci/validators.test.js.
 * Tests both success paths (against the real project) and error paths
 * (against temporary fixture directories via wrapper scripts).
 *
 * Run with: node tests/ci/validate-commands.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  test,
  createTestDir,
  cleanupTestDir,
  runValidatorWithDir,
  runValidatorWithDirs,
  runValidator,
  finish
} = require('./validator-test-utils');

console.log('\nvalidate-commands.js:');

test('passes on real project commands', () => {
  const result = runValidator('validate-commands');
  assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
});

test('exits 0 when directory does not exist', () => {
  const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', '/nonexistent/dir');
  assert.strictEqual(result.code, 0, 'Should skip when no commands dir');
});

test('fails on empty command file', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'empty.md'), '');

  const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail on empty file');
  assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
  cleanupTestDir(testDir);
});

test('passes on valid command files', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'deploy.md'), '# Deploy\nDeploy the application.');
  fs.writeFileSync(path.join(testDir, 'test.md'), '# Test\nRun all tests.');

  const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should pass for valid commands');
  assert.ok(result.stdout.includes('Validated 2'), 'Should report 2 validated');
  cleanupTestDir(testDir);
});

test('ignores non-md files', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'script.js'), 'console.log(1)');
  fs.writeFileSync(path.join(testDir, 'valid.md'), '# Command');

  const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should ignore non-md files');
  assert.ok(result.stdout.includes('Validated 1'), 'Should count only .md files');
  cleanupTestDir(testDir);
});

test('detects broken command cross-reference', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'my-cmd.md'), '# Command\nUse `/nonexistent-cmd` to do things.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should fail on broken command ref');
  assert.ok(result.stderr.includes('nonexistent-cmd'), 'Should report broken command');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('detects broken agent path reference', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\nAgent: `agents/fake-agent.md`');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should fail on broken agent ref');
  assert.ok(result.stderr.includes('fake-agent'), 'Should report broken agent');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('skips references inside fenced code blocks', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\n\n```\nagents/example-agent.md\n`/example-cmd`\n```\n');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should skip refs inside code blocks');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('detects broken workflow agent reference', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(agentsDir, 'planner.md'), '---\nmodel: sonnet\ntools: Read\n---\n# A');
  fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\nWorkflow:\nplanner -> ghost-agent');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should fail on broken workflow agent');
  assert.ok(result.stderr.includes('ghost-agent'), 'Should report broken workflow agent');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('skips command references on creates: lines', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // "Creates: `/new-table`" should NOT flag /new-table as a broken ref
  fs.writeFileSync(path.join(testDir, 'gen.md'), '# Generator\n\n→ Creates: `/new-table`\nWould create: `/new-endpoint`');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should skip creates: lines');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('accepts valid cross-reference between commands', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'build.md'), '# Build\nSee also `/deploy` for deployment.');
  fs.writeFileSync(path.join(testDir, 'deploy.md'), '# Deploy\nRun `/build` first.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should accept valid cross-refs');
  assert.ok(result.stdout.includes('Validated 2'), 'Should validate both');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('checks references in unclosed code blocks', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Unclosed code block: the ``` regex won't strip it, so refs inside are checked
  fs.writeFileSync(path.join(testDir, 'bad.md'), '# Command\n\n```\n`/phantom-cmd`\nno closing block');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  // Unclosed code blocks are NOT stripped, so refs inside are validated
  assert.strictEqual(result.code, 1, 'Should check refs in unclosed code blocks');
  assert.ok(result.stderr.includes('phantom-cmd'), 'Should report broken ref from unclosed block');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('captures ALL command references on a single line (multi-ref)', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Line with two command references — both should be detected
  fs.writeFileSync(path.join(testDir, 'multi.md'), '# Multi\nUse `/ghost-a` and `/ghost-b` together.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should fail on broken refs');
  // BOTH ghost-a AND ghost-b must be reported (this was the greedy regex bug)
  assert.ok(result.stderr.includes('ghost-a'), 'Should report first ref /ghost-a');
  assert.ok(result.stderr.includes('ghost-b'), 'Should report second ref /ghost-b');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('captures three command refs on one line', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'triple.md'), '# Triple\nChain `/alpha`, `/beta`, and `/gamma` in order.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should fail on all three broken refs');
  assert.ok(result.stderr.includes('alpha'), 'Should report /alpha');
  assert.ok(result.stderr.includes('beta'), 'Should report /beta');
  assert.ok(result.stderr.includes('gamma'), 'Should report /gamma');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('multi-ref line with one valid and one invalid ref', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // "real-cmd" exists, "fake-cmd" does not
  fs.writeFileSync(path.join(testDir, 'real-cmd.md'), '# Real\nA real command.');
  fs.writeFileSync(path.join(testDir, 'mixed.md'), '# Mixed\nRun `/real-cmd` then `/fake-cmd`.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should fail for the fake ref');
  assert.ok(result.stderr.includes('fake-cmd'), 'Should report /fake-cmd');
  // real-cmd should NOT appear in errors
  assert.ok(!result.stderr.includes('real-cmd'), 'Should not report valid /real-cmd');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('creates: line with multiple refs skips entire line', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Both refs on a "Creates:" line should be skipped entirely
  fs.writeFileSync(path.join(testDir, 'gen.md'), '# Generator\nCreates: `/new-a` and `/new-b`');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should skip all refs on creates: line');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('validates valid workflow diagram with known agents', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(agentsDir, 'planner.md'), '---\nmodel: sonnet\ntools: Read\n---\n# P');
  fs.writeFileSync(path.join(agentsDir, 'reviewer.md'), '---\nmodel: sonnet\ntools: Read\n---\n# R');
  fs.writeFileSync(path.join(testDir, 'flow.md'), '# Workflow\n\nplanner -> reviewer');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should pass on valid workflow');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

console.log('\nvalidate-commands.js (additional edge cases):');

test('reports all invalid agents in mixed agent references', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(agentsDir, 'real-agent.md'), '---\nmodel: sonnet\ntools: Read\n---\n# A');
  fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Cmd\nSee agents/real-agent.md and agents/fake-one.md and agents/fake-two.md');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should fail on invalid agent refs');
  assert.ok(result.stderr.includes('fake-one'), 'Should report first invalid agent');
  assert.ok(result.stderr.includes('fake-two'), 'Should report second invalid agent');
  assert.ok(!result.stderr.includes('real-agent'), 'Should NOT report valid agent');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('validates workflow with hyphenated agent names', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(agentsDir, 'tdd-guide.md'), '---\nmodel: sonnet\ntools: Read\n---\n# T');
  fs.writeFileSync(path.join(agentsDir, 'code-reviewer.md'), '---\nmodel: sonnet\ntools: Read\n---\n# C');
  fs.writeFileSync(path.join(testDir, 'flow.md'), '# Workflow\n\ntdd-guide -> code-reviewer');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should pass on hyphenated agent names in workflow');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('detects skill directory reference warning', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Reference a non-existent skill directory
  fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\nSee skills/nonexistent-skill/ for details.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  // Should pass (warnings don't cause exit 1) but stderr should have warning
  assert.strictEqual(result.code, 0, 'Skill warnings should not cause failure');
  assert.ok(result.stdout.includes('warning'), 'Should report warning count');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});


// --- validate-hooks.js: schema edge cases ---
console.log('\nvalidate-commands.js (whitespace edge cases):');

test('fails on whitespace-only command file', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'blank.md'), '   \n\t\n  ');

  const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject whitespace-only command file');
  assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
  cleanupTestDir(testDir);
});

test('accepts valid skill directory reference', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Create a matching skill directory
  fs.mkdirSync(path.join(skillsDir, 'my-skill'));
  fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\nSee skills/my-skill/ for details.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should pass on valid skill reference');
  assert.ok(!result.stdout.includes('warning'), 'Should have no warnings');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

// --- validate-rules.js: mixed valid/invalid ---
console.log('\nvalidate-commands.js (Round 27 edge cases):');

test('validates multiple command refs on same non-creates line', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Create two valid commands
  fs.writeFileSync(path.join(testDir, 'cmd-a.md'), '# Command A\nBasic command.');
  fs.writeFileSync(path.join(testDir, 'cmd-b.md'), '# Command B\nBasic command.');
  // Create a third command that references both on one line
  fs.writeFileSync(path.join(testDir, 'cmd-c.md'), '# Command C\nUse `/cmd-a` and `/cmd-b` together.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should pass when multiple refs on same line are all valid');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('fails when one of multiple refs on same line is invalid', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Only cmd-a exists
  fs.writeFileSync(path.join(testDir, 'cmd-a.md'), '# Command A\nBasic command.');
  // cmd-c references cmd-a (valid) and cmd-z (invalid) on same line
  fs.writeFileSync(path.join(testDir, 'cmd-c.md'), '# Command C\nUse `/cmd-a` and `/cmd-z` together.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should fail when any ref is invalid');
  assert.ok(result.stderr.includes('cmd-z'), 'Should report the invalid reference');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('code blocks are stripped before checking references', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Reference inside a code block should not be validated
  fs.writeFileSync(path.join(testDir, 'cmd-x.md'), '# Command X\n```\n`/nonexistent-cmd` in code block\n```\nEnd.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should ignore command refs inside code blocks');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

// --- validate-skills.js: mixed valid/invalid ---
console.log('\nRound 30: validate-commands (skill warnings):');

test('warns (not errors) when skill directory reference is not found', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Create a command that references a skill via path (skills/name/) format
  // but the skill doesn't exist — should warn, not error
  fs.writeFileSync(path.join(testDir, 'cmd-a.md'), '# Command A\nSee skills/nonexistent-skill/ for details.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  // Skill directory references produce warnings, not errors — exit 0
  assert.strictEqual(result.code, 0, 'Skill path references should warn, not error');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('passes when command has no slash references at all', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'cmd-simple.md'), '# Simple Command\nThis command has no references to other commands.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should pass with no references');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

console.log('\nRound 32: validate-commands (agent reference with valid workflow):');

test('passes workflow with three chained agents', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(agentsDir, 'planner.md'), '---\nmodel: sonnet\ntools: Read\n---\n# P');
  fs.writeFileSync(path.join(agentsDir, 'tdd-guide.md'), '---\nmodel: sonnet\ntools: Read\n---\n# T');
  fs.writeFileSync(path.join(agentsDir, 'code-reviewer.md'), '---\nmodel: sonnet\ntools: Read\n---\n# C');
  fs.writeFileSync(path.join(testDir, 'flow.md'), '# Flow\n\nplanner -> tdd-guide -> code-reviewer');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should pass on valid 3-agent workflow');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

test('detects broken agent in middle of workflow chain', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(agentsDir, 'planner.md'), '---\nmodel: sonnet\ntools: Read\n---\n# P');
  fs.writeFileSync(path.join(agentsDir, 'code-reviewer.md'), '---\nmodel: sonnet\ntools: Read\n---\n# C');
  // missing-agent is NOT created
  fs.writeFileSync(path.join(testDir, 'flow.md'), '# Flow\n\nplanner -> missing-agent -> code-reviewer');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should detect broken agent in workflow chain');
  assert.ok(result.stderr.includes('missing-agent'), 'Should report the missing agent');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

// ── Round 42: case sensitivity, space-before-colon, missing dirs, empty matchers ──
console.log('\nRound 42: validate-commands (missing agents dir):');

test('flags agent path references when AGENTS_DIR does not exist', () => {
  const testDir = createTestDir();
  const skillsDir = createTestDir();
  // AGENTS_DIR points to non-existent path → validAgents set stays empty
  fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\nSee agents/planner.md for details.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: '/nonexistent/agents-dir',
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 1, 'Should fail when agents dir missing but agent referenced');
  assert.ok(result.stderr.includes('planner'), 'Should report the unresolvable agent reference');
  cleanupTestDir(testDir);
  cleanupTestDir(skillsDir);
});

console.log('\nRound 52: validate-commands (inline backtick refs):');

test('validates command refs inside inline backticks (not stripped by code block removal)', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'deploy.md'), '# Deploy\nDeploy the app.');
  // Inline backtick ref `/deploy` should be validated (only fenced blocks stripped)
  fs.writeFileSync(path.join(testDir, 'workflow.md'), '# Workflow\nFirst run `/deploy` to deploy the app.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Inline backtick command refs should be validated');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

console.log('\nRound 52: validate-commands (workflow whitespace):');

test('validates workflow arrows with irregular whitespace', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  fs.writeFileSync(path.join(agentsDir, 'planner.md'), '# Planner');
  fs.writeFileSync(path.join(agentsDir, 'reviewer.md'), '# Reviewer');
  // Three workflow lines: no spaces, double spaces, tab-separated
  fs.writeFileSync(path.join(testDir, 'flow.md'), '# Workflow\n\nplanner->reviewer\nplanner  ->  reviewer');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Workflow arrows with irregular whitespace should be valid');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

console.log('\nRound 57: validate-commands.js (adjacent code blocks both stripped):');

test('strips multiple adjacent code blocks before checking references', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Two adjacent code blocks, each with broken refs — BOTH must be stripped
  fs.writeFileSync(
    path.join(testDir, 'multi-blocks.md'),
    '# Multi Block\n\n' + '```\n`/phantom-a` in first block\n```\n\n' + 'Content between blocks\n\n' + '```\n`/phantom-b` in second block\nagents/ghost-agent.md\n```\n\n' + 'Final content'
  );

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Both code blocks should be stripped — no broken refs reported');
  assert.ok(!result.stderr.includes('phantom-a'), 'First block ref should be stripped');
  assert.ok(!result.stderr.includes('phantom-b'), 'Second block ref should be stripped');
  assert.ok(!result.stderr.includes('ghost-agent'), 'Agent ref in second block should be stripped');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

// ── Round 58: readFileSync catch block, colonIdx edge case, command-as-object ──
console.log('\nRound 63: validate-commands.js (unreadable command file):');

test('reports error when command .md file is unreadable (chmod 000)', () => {
  if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) {
    console.log('    (skipped — not supported on this platform)');
    return;
  }
  const testDir = createTestDir();
  const cmdFile = path.join(testDir, 'locked.md');
  fs.writeFileSync(cmdFile, '# Locked Command');
  fs.chmodSync(cmdFile, 0o000);

  try {
    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir,
      AGENTS_DIR: '/nonexistent',
      SKILLS_DIR: '/nonexistent'
    });
    assert.strictEqual(result.code, 1, 'Should exit 1 on read error');
    assert.ok(result.stderr.includes('locked.md'), 'Should mention the unreadable file');
  } finally {
    fs.chmodSync(cmdFile, 0o644);
    cleanupTestDir(testDir);
  }
});

console.log('\nRound 63: validate-commands.js (empty commands directory):');

test('passes on empty commands directory (no .md files)', () => {
  const testDir = createTestDir();
  // Only non-.md files — no .md files to validate
  fs.writeFileSync(path.join(testDir, 'readme.txt'), 'not a command');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: '/nonexistent',
    SKILLS_DIR: '/nonexistent'
  });
  assert.strictEqual(result.code, 0, 'Should pass on empty commands directory');
  assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 validated');
  cleanupTestDir(testDir);
});

// ── Round 65: empty directories for rules and skills ──
console.log('\nRound 70: validate-commands.js (would create: skip):');

test('skips command references on "would create:" lines', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // "Would create:" is the alternate form checked by the regex at line 80:
  //   if (/creates:|would create:/i.test(line)) continue;
  // Only "creates:" was previously tested (Round 20). "Would create:" exercises
  // the second alternation in the regex.
  fs.writeFileSync(path.join(testDir, 'gen-cmd.md'), '# Generator Command\n\nWould create: `/phantom-cmd` in your project.\n\nThis is safe.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should skip "would create:" lines');
  assert.ok(!result.stderr.includes('phantom-cmd'), 'Should not flag ref on "would create:" line');
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

// ── Round 72: validate-hooks.js async/timeout type validation ──
console.log('\nRound 73: validate-commands.js (unreadable skill entry — statSync catch):');

test('skips unreadable skill directory entries without error (broken symlink)', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();

  // Create one valid skill directory and one broken symlink
  const validSkill = path.join(skillsDir, 'valid-skill');
  fs.mkdirSync(validSkill, { recursive: true });
  // Broken symlink: target does not exist — statSync will throw ENOENT
  const brokenLink = path.join(skillsDir, 'broken-skill');
  try {
    fs.symlinkSync('/nonexistent/target/path', brokenLink);
  } catch (err) {
    // Skip only where symlink creation is blocked (e.g. Windows without
    // Developer Mode / admin rights → EPERM/EACCES); rethrow anything else
    // so real failures aren't masked.
    if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
      console.log('    (skipped — symlinks not supported)');
      cleanupTestDir(testDir);
      cleanupTestDir(agentsDir);
      fs.rmSync(skillsDir, { recursive: true, force: true });
      return;
    }
    throw err;
  }

  // Command that references the valid skill (should resolve)
  fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\nSee skills/valid-skill/ for details.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Should pass — broken symlink in skills dir should be skipped silently');
  // The broken-skill should NOT be in validSkills, so referencing it would warn
  // but the valid-skill reference should resolve fine
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  fs.rmSync(skillsDir, { recursive: true, force: true });
});

// ── Round 76: validate-hooks.js invalid JSON in hooks.json ──
console.log('\nRound 79: validate-commands.js (warnings count in output):');

test('output includes (N warnings) suffix when skill references produce warnings', () => {
  const testDir = createTestDir();
  const agentsDir = createTestDir();
  const skillsDir = createTestDir();
  // Create a command that references 2 non-existent skill directories
  // Each triggers a WARN (not error) — warnCount should be 2
  fs.writeFileSync(path.join(testDir, 'cmd-warn.md'), '# Command\nSee skills/fake-skill-a/ and skills/fake-skill-b/ for details.');

  const result = runValidatorWithDirs('validate-commands', {
    COMMANDS_DIR: testDir,
    AGENTS_DIR: agentsDir,
    SKILLS_DIR: skillsDir
  });
  assert.strictEqual(result.code, 0, 'Skill warnings should not cause error exit');
  // The validate-commands output appends "(N warnings)" when warnCount > 0
  assert.ok(result.stdout.includes('(2 warnings)'), `Output should include "(2 warnings)" suffix, got: ${result.stdout}`);
  cleanupTestDir(testDir);
  cleanupTestDir(agentsDir);
  cleanupTestDir(skillsDir);
});

// ── Round 80: validate-hooks.js legacy array format (lines 115-135) ──

finish();
