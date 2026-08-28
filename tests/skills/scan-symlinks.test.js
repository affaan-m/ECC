'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scanStocktake = path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'scan.sh');
const scanDistillSkills = path.join(repoRoot, 'skills', 'rules-distill', 'scripts', 'scan-skills.sh');
const scanDistillRules = path.join(repoRoot, 'skills', 'rules-distill', 'scripts', 'scan-rules.sh');

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

console.log('\n=== Scan scripts symlink support tests ===\n');

test('scan.sh enumerates symlinked skill directories', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-scan-test-'));
  try {
    const globalSkillsDir = path.join(tmpDir, 'global-skills');
    const externalSkillsDir = path.join(tmpDir, 'external-skills');
    fs.mkdirSync(path.join(globalSkillsDir, 'skill-direct'), { recursive: true });
    fs.mkdirSync(path.join(externalSkillsDir, 'skill-symlinked'), { recursive: true });

    fs.writeFileSync(
      path.join(globalSkillsDir, 'skill-direct', 'SKILL.md'),
      '---\nname: skill-direct\ndescription: "Direct skill"\n---\n# Direct'
    );
    fs.writeFileSync(
      path.join(externalSkillsDir, 'skill-symlinked', 'SKILL.md'),
      '---\nname: skill-symlinked\ndescription: "Symlinked skill"\n---\n# Symlinked'
    );

    // Symlink external skill into global skills directory
    fs.symlinkSync(
      path.join(externalSkillsDir, 'skill-symlinked'),
      path.join(globalSkillsDir, 'skill-symlinked'),
      'dir'
    );

    const stdout = execFileSync('bash', [scanStocktake], {
      env: {
        ...process.env,
        SKILL_STOCKTAKE_GLOBAL_DIR: globalSkillsDir,
        SKILL_STOCKTAKE_PROJECT_DIR: '',
      },
      encoding: 'utf8',
    });

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.scan_summary.global.found, true);
    assert.strictEqual(parsed.scan_summary.global.count, 2, 'Expected 2 skills (1 direct, 1 symlinked)');

    const names = parsed.skills.map((s) => s.name).sort();
    assert.deepStrictEqual(names, ['skill-direct', 'skill-symlinked']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scan-skills.sh enumerates symlinked skill directories', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-scan-skills-test-'));
  try {
    const globalSkillsDir = path.join(tmpDir, 'global-skills');
    const externalSkillsDir = path.join(tmpDir, 'external-skills');
    fs.mkdirSync(path.join(globalSkillsDir, 'skill-alpha'), { recursive: true });
    fs.mkdirSync(path.join(externalSkillsDir, 'skill-beta'), { recursive: true });

    fs.writeFileSync(
      path.join(globalSkillsDir, 'skill-alpha', 'SKILL.md'),
      '---\nname: skill-alpha\ndescription: "Alpha skill"\n---\n# Alpha'
    );
    fs.writeFileSync(
      path.join(externalSkillsDir, 'skill-beta', 'SKILL.md'),
      '---\nname: skill-beta\ndescription: "Beta skill"\n---\n# Beta'
    );

    fs.symlinkSync(
      path.join(externalSkillsDir, 'skill-beta'),
      path.join(globalSkillsDir, 'skill-beta'),
      'dir'
    );

    const stdout = execFileSync('bash', [scanDistillSkills], {
      env: {
        ...process.env,
        RULES_DISTILL_GLOBAL_DIR: globalSkillsDir,
        RULES_DISTILL_PROJECT_DIR: '',
      },
      encoding: 'utf8',
    });

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.scan_summary.global.count, 2, 'Expected 2 skills in rules-distill scan-skills');
    const names = parsed.skills.map((s) => s.name).sort();
    assert.deepStrictEqual(names, ['skill-alpha', 'skill-beta']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scan-rules.sh enumerates symlinked rule files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-scan-rules-test-'));
  try {
    const rulesDir = path.join(tmpDir, 'rules');
    const externalDir = path.join(tmpDir, 'external-rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.mkdirSync(externalDir, { recursive: true });

    fs.writeFileSync(
      path.join(rulesDir, 'rule-a.md'),
      '# Rule A\n\n## Section 1\nContent'
    );
    fs.writeFileSync(
      path.join(externalDir, 'rule-b.md'),
      '# Rule B\n\n## Section 2\nContent'
    );

    fs.symlinkSync(
      path.join(externalDir, 'rule-b.md'),
      path.join(rulesDir, 'rule-b.md'),
      'file'
    );

    const stdout = execFileSync('bash', [scanDistillRules, rulesDir], {
      env: {
        ...process.env,
      },
      encoding: 'utf8',
    });

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.total, 2, 'Expected 2 rules (1 direct, 1 symlinked)');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
