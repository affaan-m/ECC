#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scannerPaths = [
  path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'scan.sh'),
  path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'quick-diff.sh'),
];
const bashPath = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  : 'bash';

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

function extractDiscoveryCommand(scannerPath) {
  const source = fs.readFileSync(scannerPath, 'utf8');
  const match = source.match(/done < <\((find [^\r\n]+)\)/);
  assert.ok(match, `Could not find the discovery command in ${scannerPath}`);
  return match[1];
}

function runDiscovery(scannerPath, skillsDir) {
  const discoveryCommand = extractDiscoveryCommand(scannerPath);
  const command = process.platform === 'win32'
    ? `dir=$(cygpath -u "$dir"); ${discoveryCommand}`
    : discoveryCommand;
  const result = spawnSync(bashPath, ['-c', command], {
    encoding: 'utf8',
    env: { ...process.env, dir: skillsDir },
  });

  assert.strictEqual(result.status, 0, result.stderr || 'skill discovery failed');
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(filePath => filePath.replace(/\\/g, '/'));
}

function writeSkill(skillDir, name) {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test fixture\n---\n# ${name}\n`,
  );
}

console.log('\nSkill stocktake discovery tests:');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-stocktake-'));

try {
  for (const scannerPath of scannerPaths) {
    const scannerName = path.basename(scannerPath);

    if (process.platform === 'win32') {
      console.log(`  ↷ ${scannerName} symlink case skipped on Windows`);
    } else {
      test(`${scannerName} follows symlinked skill directories`, () => {
        const fixtureRoot = path.join(tempRoot, `${scannerName}-symlink`);
        const skillsDir = path.join(fixtureRoot, 'skills');
        const targetDir = path.join(fixtureRoot, 'shared', 'linked-skill');
        const linkedDir = path.join(skillsDir, 'linked-skill');
        writeSkill(targetDir, 'linked-skill');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.symlinkSync(targetDir, linkedDir, 'dir');

        const discovered = runDiscovery(scannerPath, skillsDir);

        assert.strictEqual(discovered.length, 1);
        assert.ok(
          discovered[0].endsWith('/linked-skill/SKILL.md'),
          `Expected linked SKILL.md, got ${discovered[0]}`,
        );
      });
    }

    test(`${scannerName} ignores Markdown assets inside a skill`, () => {
      const skillsDir = path.join(tempRoot, `${scannerName}-assets`, 'skills');
      const skillDir = path.join(skillsDir, 'direct-skill');
      const referencePath = path.join(skillDir, 'references', 'notes.md');
      writeSkill(skillDir, 'direct-skill');
      fs.mkdirSync(path.dirname(referencePath), { recursive: true });
      fs.writeFileSync(referencePath, '# Supporting notes\n');

      const discovered = runDiscovery(scannerPath, skillsDir);

      assert.strictEqual(discovered.length, 1);
      assert.ok(
        discovered[0].endsWith('/direct-skill/SKILL.md'),
        `Expected direct SKILL.md, got ${discovered[0]}`,
      );
    });
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
