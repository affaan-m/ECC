#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scanScript = path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'scan.sh');
const quickDiffScript = path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'quick-diff.sh');

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${description}: ${error.message}`);
    failed++;
  }
}

function writeSkill(skillDir, name) {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test fixture\n---\n# ${name}\n`,
  );
}

function runBash(scriptPath, args, env) {
  return spawnSync('bash', [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

console.log('\nSkill stocktake discovery tests:');

test('both scanners use canonical, error-visible, NUL-delimited discovery', () => {
  for (const scriptPath of [scanScript, quickDiffScript]) {
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.match(source, /find -L "\$dir" -name "SKILL\.md" -type f -print0/);
    assert.match(source, /sort -z -o "\$find_out" "\$find_out"/);
    assert.match(source, /read -r -d '' file/);
    assert.doesNotMatch(source, /find [^\n]*2>\/dev\/null/, `${path.basename(scriptPath)} still hides find errors`);
  }
});

if (process.platform === 'win32') {
  console.log('  ↷ POSIX symlink and newline-path integration cases skipped on Windows');
} else {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-stocktake-'));
  try {
    const projectSkills = path.join(tempRoot, 'project', '.claude', 'skills');
    const directSkill = path.join(projectSkills, 'direct-skill');
    const linkedTarget = path.join(tempRoot, 'shared', 'linked-skill');
    const newlineSkill = path.join(projectSkills, 'newline\nskill');
    const resultsPath = path.join(tempRoot, 'results.json');

    writeSkill(directSkill, 'direct-skill');
    writeSkill(linkedTarget, 'linked-skill');
    writeSkill(newlineSkill, 'newline-skill');
    fs.symlinkSync(linkedTarget, path.join(projectSkills, 'linked-skill'), 'dir');
    fs.mkdirSync(path.join(directSkill, 'references'), { recursive: true });
    fs.writeFileSync(path.join(directSkill, 'references', 'notes.md'), '# supporting notes\n');
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({ evaluated_at: '2099-01-01T00:00:00Z', skills: [] }),
    );

    const env = {
      SKILL_STOCKTAKE_GLOBAL_DIR: path.join(tempRoot, 'missing-global'),
      SKILL_STOCKTAKE_PROJECT_DIR: projectSkills,
      SKILL_STOCKTAKE_OBSERVATIONS: path.join(tempRoot, 'missing-observations.jsonl'),
    };

    test('scan follows symlinked skills and ignores nested Markdown assets', () => {
      const result = runBash(scanScript, [], env);
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.scan_summary.project.count, 3);
      assert.deepStrictEqual(
        output.skills.map(skill => skill.name).sort(),
        ['direct-skill', 'linked-skill', 'newline-skill'],
      );
    });

    test('quick diff keeps newline-containing skill paths as one record', () => {
      const result = runBash(quickDiffScript, [resultsPath], env);
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.length, 3);
      assert.strictEqual(
        output.filter(entry => entry.path.includes('newline\nskill/SKILL.md')).length,
        1,
      );
      assert.ok(output.every(entry => entry.is_new === true));
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
