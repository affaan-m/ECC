/**
 * Tests for validate-skills.js — SKILL.md frontmatter validation.
 *
 * Split from the original monolithic tests/ci/validators.test.js.
 * Tests both success paths (against the real project) and error paths
 * (against temporary fixture directories via wrapper scripts).
 *
 * Run with: node tests/ci/validate-skills.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  test,
  createTestDir,
  cleanupTestDir,
  runValidatorWithDir,
  runValidator,
  runSkillsValidator,
  finish
} = require('./validator-test-utils');

console.log('\nvalidate-skills.js:');

test('passes on real project skills', () => {
  const result = runValidator('validate-skills');
  assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
});

test('exits 0 when directory does not exist', () => {
  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', '/nonexistent/dir');
  assert.strictEqual(result.code, 0, 'Should skip when no skills dir');
});

test('fails on skill directory without SKILL.md', () => {
  const testDir = createTestDir();
  fs.mkdirSync(path.join(testDir, 'broken-skill'));
  // No SKILL.md inside

  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail on missing SKILL.md');
  assert.ok(result.stderr.includes('Missing SKILL.md'), 'Should report missing SKILL.md');
  cleanupTestDir(testDir);
});

test('fails on empty SKILL.md', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'empty-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '');

  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail on empty SKILL.md');
  assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
  cleanupTestDir(testDir);
});

test('passes on valid skill directory', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'good-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\nDescription here.');

  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should pass for valid skill');
  assert.ok(result.stdout.includes('Validated 1'), 'Should report 1 validated');
  cleanupTestDir(testDir);
});

test('ignores non-directory entries', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'not-a-skill.md'), '# README');
  const skillDir = path.join(testDir, 'real-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill');

  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should ignore non-directory entries');
  assert.ok(result.stdout.includes('Validated 1'), 'Should count only directories');
  cleanupTestDir(testDir);
});

test('fails on whitespace-only SKILL.md', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'blank-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '   \n\t\n  ');

  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject whitespace-only SKILL.md');
  assert.ok(result.stderr.includes('Empty file'), 'Should report empty file');
  cleanupTestDir(testDir);
});

test('warns when frontmatter is missing name (default mode)', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'no-name-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\ndescription: "X"\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir);
  assert.strictEqual(result.code, 0, `Default mode must not fail CI; got stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('WARN') && result.stderr.includes('missing required field: name'), `Should warn on missing name; got stderr: ${result.stderr}`);
  cleanupTestDir(testDir);
});

test('errors when frontmatter is missing name (strict mode)', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'no-name-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\ndescription: "X"\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir, ['--strict']);
  assert.strictEqual(result.code, 1, '--strict must fail CI on missing name');
  assert.ok(result.stderr.includes('missing required field: name'), 'Should report missing name');
  cleanupTestDir(testDir);
});

test('warns on literal block-scalar description (|-)', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'block-desc-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: block-desc-skill\ndescription: |-\n  line one\n  line two\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir);
  assert.strictEqual(result.code, 0, 'Default mode should not fail CI');
  assert.ok(result.stderr.includes('WARN') && result.stderr.includes('literal block scalar'), `Should warn on |- description; got stderr: ${result.stderr}`);
  cleanupTestDir(testDir);
});

test('accepts folded (>) and inline descriptions', () => {
  const testDir = createTestDir();
  const folded = path.join(testDir, 'folded-skill');
  fs.mkdirSync(folded);
  fs.writeFileSync(path.join(folded, 'SKILL.md'), '---\nname: folded-skill\ndescription: >\n  joined\n  on spaces\norigin: ECC\n---\n# Skill');
  const inline = path.join(testDir, 'inline-skill');
  fs.mkdirSync(inline);
  fs.writeFileSync(path.join(inline, 'SKILL.md'), '---\nname: inline-skill\ndescription: "single line"\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir, ['--strict']);
  assert.strictEqual(result.code, 0, `Folded and inline should pass strict; got stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated 2'), `Should count both skills; got stdout: ${result.stdout}`);
  cleanupTestDir(testDir);
});

test('skips hidden directories under skills/', () => {
  const testDir = createTestDir();
  // A dot-prefixed directory (e.g. .DS_Store-adjacent junk or legacy
  // cache) must not count as a skill and must not error.
  fs.mkdirSync(path.join(testDir, '.cache'));
  fs.writeFileSync(path.join(testDir, '.cache', 'SKILL.md'), '# ignored');
  const real = path.join(testDir, 'real-skill');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'SKILL.md'), '---\nname: real-skill\ndescription: "x"\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir, ['--strict']);
  assert.strictEqual(result.code, 0, 'Hidden dirs should be skipped');
  assert.ok(result.stdout.includes('Validated 1'), `Should only count the non-hidden skill; got stdout: ${result.stdout}`);
  cleanupTestDir(testDir);
});

test('warns when name: value is empty or whitespace', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'empty-name-skill');
  fs.mkdirSync(skillDir);
  // `name:` key present but value is blank.
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname:    \ndescription: "X"\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir);
  assert.strictEqual(result.code, 0, `Default mode must not fail CI; got stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('WARN') && result.stderr.includes("'name' is empty"), `Should warn on empty name; got stderr: ${result.stderr}`);
  cleanupTestDir(testDir);
});

test('warns on literal block-scalar description with |+ chomp', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'keep-desc-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: keep-desc-skill\ndescription: |+\n  line one\n  line two\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir);
  assert.strictEqual(result.code, 0, 'Default mode should not fail CI');
  assert.ok(result.stderr.includes('literal block scalar'), `Should warn on |+ description; got stderr: ${result.stderr}`);
  cleanupTestDir(testDir);
});

test('warns on block-scalar description with indent indicator and trailing comment', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'indent-desc-skill');
  fs.mkdirSync(skillDir);
  // `|-2  # note` is still a literal block scalar in YAML 1.2.
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: indent-desc-skill\ndescription: |-2  # trimmed two-space indent\n    line one\n    line two\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir);
  assert.strictEqual(result.code, 0, 'Default mode should not fail CI');
  assert.ok(result.stderr.includes('literal block scalar'), `Should warn on |-2 description; got stderr: ${result.stderr}`);
  cleanupTestDir(testDir);
});

test('honors CI_STRICT_SKILLS=1 env flag', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'no-name-skill-env');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\ndescription: "X"\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir, [], { CI_STRICT_SKILLS: '1' });
  assert.strictEqual(result.code, 1, 'CI_STRICT_SKILLS=1 must fail CI on missing name');
  assert.ok(result.stderr.includes('missing required field: name'), 'Should report missing name');
  cleanupTestDir(testDir);
});

test('flags comment-only name value as empty (strict)', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'comment-only-name');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: # todo\ndescription: "X"\norigin: ECC\n---\n# Skill');

  const result = runSkillsValidator(testDir, ['--strict']);
  assert.strictEqual(result.code, 1, 'Strict mode must fail CI on empty name');
  assert.ok(result.stderr.includes("'name' is empty"), `Should report empty name; got stderr: ${result.stderr}`);
  cleanupTestDir(testDir);
});

test('tolerates ---trailing text outside frontmatter block', () => {
  // A SKILL.md whose body contains a line starting with '---text'
  // must not be parsed as frontmatter. Regression guard for
  // closing-delimiter tightening: the old regex would greedily
  // match '---trailing'.
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'no-frontmatter-dashes');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill\n\nSome body text.\n\n---trailing content\nmore body\n');

  const result = runSkillsValidator(testDir, ['--strict']);
  assert.strictEqual(result.code, 0, `Should not flag frontmatter findings when no valid frontmatter exists; got stderr: ${result.stderr}`);
  assert.ok(!result.stderr.includes('missing required field: name'), 'Must not treat ---trailing as a frontmatter closer');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-skills.js (mixed dirs):');

test('fails on mix of valid and invalid skill directories', () => {
  const testDir = createTestDir();
  // Valid skill
  const goodSkill = path.join(testDir, 'good-skill');
  fs.mkdirSync(goodSkill);
  fs.writeFileSync(path.join(goodSkill, 'SKILL.md'), '# Good Skill');
  // Missing SKILL.md
  const badSkill = path.join(testDir, 'bad-skill');
  fs.mkdirSync(badSkill);
  // Empty SKILL.md
  const emptySkill = path.join(testDir, 'empty-skill');
  fs.mkdirSync(emptySkill);
  fs.writeFileSync(path.join(emptySkill, 'SKILL.md'), '');

  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail when any skill is invalid');
  assert.ok(result.stderr.includes('bad-skill'), 'Should report missing SKILL.md');
  assert.ok(result.stderr.includes('empty-skill'), 'Should report empty SKILL.md');
  cleanupTestDir(testDir);
});

// ── Round 30: validate-commands skill warnings and workflow edge cases ──
console.log('\nRound 57: validate-skills.js (SKILL.md is a directory — readFileSync error):');

test('fails gracefully when SKILL.md is a directory instead of a file', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'dir-skill');
  fs.mkdirSync(skillDir);
  // Create SKILL.md as a DIRECTORY, not a file — existsSync returns true
  // but readFileSync throws EISDIR, exercising the catch block (lines 33-37)
  fs.mkdirSync(path.join(skillDir, 'SKILL.md'));

  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail when SKILL.md is a directory');
  assert.ok(result.stderr.includes('dir-skill'), 'Should report the problematic skill');
  cleanupTestDir(testDir);
});

console.log('\nRound 65: validate-skills.js (empty directory — no subdirectories):');

test('passes on skills directory with only files, no subdirectories (Validated 0)', () => {
  const testDir = createTestDir();
  // Only files, no subdirectories — isDirectory filter yields empty array
  fs.writeFileSync(path.join(testDir, 'README.md'), '# Skills');
  fs.writeFileSync(path.join(testDir, '.gitkeep'), '');

  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should pass on skills directory with no subdirectories');
  assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 validated skill directories');
  cleanupTestDir(testDir);
});

// ── Round 70: validate-commands.js "would create:" line skip ──
console.log('\nRound 83: validate-skills (empty SKILL.md file):');

test('rejects skill directory with empty SKILL.md file', () => {
  const testDir = createTestDir();
  const skillDir = path.join(testDir, 'empty-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  // Create SKILL.md with only whitespace (trim to zero length)
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '   \n  \n');

  const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject empty SKILL.md');
  assert.ok(result.stderr.includes('Empty file'), `Should report "Empty file", got: ${result.stderr}`);
  cleanupTestDir(testDir);
});

finish();
