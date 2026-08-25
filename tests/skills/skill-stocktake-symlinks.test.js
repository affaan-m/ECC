/**
 * Regression tests for #2801: skill-stocktake dropped symlinked skills.
 *
 * `find "$dir" -name "*.md" -type f` does not descend into a symlinked
 * directory, and `-type f` is false for a symlinked file, so a skill installed
 * as a symlink — package-manager installs, app-bundled skills, skills shared
 * between tools — was silently absent from the inventory. The reporter had 4
 * skills, 3 of them symlinks, and got a count of 1.
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = [
  path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'scan.sh'),
  path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'quick-diff.sh'),
];
const bashBinary = process.env.ECC_TEST_BASH || (process.platform === 'win32' ? null : 'bash');

function toShellPath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  return normalized.replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
}

function findLine(scriptPath) {
  return fs
    .readFileSync(scriptPath, 'utf8')
    .split('\n')
    .find(line => line.includes('find') && line.includes('-name "*.md"'));
}

/** Build 2 real + 2 symlinked skill dirs. Returns null if links are unavailable. */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stocktake-'));
  const skills = path.join(root, 'home', '.claude', 'skills');
  const elsewhere = path.join(root, 'elsewhere');
  const write = dir => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${path.basename(dir)}\ndescription: fixture\n---\n\nbody\n`
    );
  };
  write(path.join(skills, 'real-a'));
  write(path.join(skills, 'real-b'));
  write(path.join(elsewhere, 'pkg-skill'));
  write(path.join(elsewhere, 'shared-skill'));
  try {
    for (const name of ['pkg-skill', 'shared-skill']) {
      // 'junction' is the Windows form that needs no elevation; ignored elsewhere.
      fs.symlinkSync(path.join(elsewhere, name), path.join(skills, name), 'junction');
    }
  } catch {
    fs.rmSync(root, { recursive: true, force: true });
    return null;
  }
  return { root, skills };
}

let passed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function main() {
  console.log('\n=== Testing skill-stocktake symlink enumeration (#2801) ===\n');

  const tests = [];

  // Both scripts enumerate the same inventory; a quick-diff that disagreed with
  // scan would report every symlinked skill as an addition or a removal.
  for (const scriptPath of scripts) {
    const rel = path.relative(repoRoot, scriptPath).split(path.sep).join('/');
    tests.push([`${rel} follows symlinks when enumerating`, () => {
      const line = findLine(scriptPath);
      assert.ok(line, `no *.md find expression in ${rel}`);
      assert.match(line, /find\s+-L\s/, `${rel} must use find -L`);
    }]);
  }

  if (bashBinary) {
    tests.push(['the shipped find expression sees a symlinked skill', () => {
      const fixture = makeFixture();
      if (fixture === null) {
        console.log('    (skipped: this system does not allow creating links)');
        return;
      }
      try {
        // Run the exact expression the scripts ship, not a paraphrase of it.
        const expression = findLine(scripts[0]).trim().replace(/^done < <\(/, '').replace(/\)$/, '');
        const command = expression.replace('"$dir"', `"${toShellPath(fixture.skills)}"`);
        const result = spawnSync(bashBinary, ['-c', command], { encoding: 'utf8' });
        assert.strictEqual(result.status, 0, result.stderr);
        const found = (result.stdout || '').split('\n').filter(Boolean);
        assert.strictEqual(
          found.length,
          4,
          `expected 2 real + 2 symlinked skills, got ${found.length}:\n${found.join('\n')}`
        );
        for (const name of ['real-a', 'real-b', 'pkg-skill', 'shared-skill']) {
          assert.ok(
            found.some(entry => entry.includes(`/${name}/`)),
            `${name} missing from the inventory`
          );
        }
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    }]);
  } else {
    console.log('  - integration coverage skipped on Windows without ECC_TEST_BASH');
  }

  let failed = 0;
  for (const [name, fn] of tests) {
    if (runTest(name, fn)) passed += 1;
    else failed += 1;
  }

  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  // exitCode, not exit(1): stdout is async when it is a pipe, which is how
  // tests/run-all.js runs this, and process.exit() does not wait for pending
  // writes — it could drop the two lines above, which the aggregator totals.
  if (failed > 0) process.exitCode = 1;
}

main();
