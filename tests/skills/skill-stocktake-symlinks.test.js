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

// Creating a link can fail because the platform or filesystem does not offer
// them — that is a skip. Any other failure is a broken fixture and must not be
// reported as a passing test.
const LINKS_UNSUPPORTED = new Set(['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP']);

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

function writeSkill(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, `---\nname: ${path.basename(dir)}\ndescription: fixture\n---\n\nbody\n`);
  return file;
}

/**
 * Link `target` to `linkPath`, or return false when this system has no links.
 *
 * @param {string} target
 * @param {string} linkPath
 * @param {'junction'|'file'} type 'junction' is the Windows directory form that
 *   needs no elevation; a file link does need it, hence the separate answer.
 * @returns {boolean}
 */
function tryLink(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (LINKS_UNSUPPORTED.has(error.code)) return false;
    throw error;
  }
}

/**
 * Build the inventory the reporter had: real skills beside linked ones.
 *
 * Directory links are required — without them there is nothing to test, so a
 * system that cannot make them skips the case. A skill whose SKILL.md is
 * *itself* a link is the second half of the bug (`-type f` is false for one),
 * but that form needs elevation on Windows, so it is reported separately
 * rather than skipping the whole fixture.
 *
 * @returns {{root: string, skills: string, expected: string[], fileLink: boolean}|null}
 */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stocktake-'));
  try {
    const skills = path.join(root, 'home', '.claude', 'skills');
    const elsewhere = path.join(root, 'elsewhere');
    writeSkill(path.join(skills, 'real-a'));
    writeSkill(path.join(skills, 'real-b'));
    for (const name of ['pkg-skill', 'shared-skill']) writeSkill(path.join(elsewhere, name));
    const standalone = writeSkill(path.join(elsewhere, 'standalone'));

    const expected = ['real-a', 'real-b'];
    for (const name of ['pkg-skill', 'shared-skill']) {
      if (!tryLink(path.join(elsewhere, name), path.join(skills, name), 'junction')) {
        fs.rmSync(root, { recursive: true, force: true });
        return null;
      }
      expected.push(name);
    }

    const linkedFileDir = path.join(skills, 'file-link-skill');
    fs.mkdirSync(linkedFileDir, { recursive: true });
    const fileLink = tryLink(standalone, path.join(linkedFileDir, 'SKILL.md'), 'file');
    if (fileLink) expected.push('file-link-skill');
    else fs.rmSync(linkedFileDir, { recursive: true, force: true });

    return { root, skills, expected, fileLink };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

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

// Both scripts enumerate the same inventory; a quick-diff that disagreed with
// scan would report every symlinked skill as an addition or a removal.
const expressionTests = scripts.map(scriptPath => {
  const rel = path.relative(repoRoot, scriptPath).split(path.sep).join('/');
  return [
    `${rel} follows symlinks when enumerating`,
    () => {
      const line = findLine(scriptPath);
      assert.ok(line, `no *.md find expression in ${rel}`);
      assert.match(line, /find\s+-L\s/, `${rel} must use find -L`);
    },
  ];
});

// Each script gets its own run. Checking one and static-checking the other
// would let a differently broken expression in the unrun script pass, which
// is the disagreement between the two inventories this PR is about.
const integrationTests = bashBinary
  ? scripts.map(scriptPath => {
      const rel = path.relative(repoRoot, scriptPath).split(path.sep).join('/');
      return [
        `${rel}: the shipped find expression sees linked skills`,
        () => {
          const fixture = makeFixture();
          if (fixture === null) {
            console.log('    (skipped: this system does not allow creating links)');
            return;
          }
          try {
            // Run the exact expression the scripts ship, unmodified: `$dir` is
            // bound from a positional argument instead of being substituted
            // into the command text, so a fixture path containing shell syntax
            // is data rather than something bash parses.
            const expression = findLine(scriptPath).trim().replace(/^done < <\(/, '').replace(/\)$/, '');
            const result = spawnSync(
              bashBinary,
              ['-c', `dir="$1"; ${expression}`, 'skill-stocktake-test', toShellPath(fixture.skills)],
              { encoding: 'utf8' }
            );
            if (result.error) {
              // No bash on this system: `status` is null, so the exit-status
              // assertion below would report a confusing empty stderr instead
              // of saying the binary is missing.
              if (result.error.code === 'ENOENT') {
                console.log(`    (skipped: ${bashBinary} not found)`);
                return;
              }
              throw result.error;
            }
            assert.strictEqual(result.status, 0, result.stderr);
            const found = (result.stdout || '').split('\n').filter(Boolean);
            if (!fixture.fileLink) {
              console.log('    (a SKILL.md that is itself a link needs elevation here; skipped)');
            }
            assert.strictEqual(
              found.length,
              fixture.expected.length,
              `expected ${fixture.expected.join(', ')}, got ${found.length}:\n${found.join('\n')}`
            );
            for (const name of fixture.expected) {
              assert.ok(
                found.some(entry => entry.includes(`/${name}/`)),
                `${name} missing from the inventory`
              );
            }
          } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true });
          }
        },
      ];
    })
  : [];

function main() {
  console.log('\n=== Testing skill-stocktake symlink enumeration (#2801) ===\n');

  if (!bashBinary) {
    console.log('  - integration coverage skipped on Windows without ECC_TEST_BASH');
  }

  const tests = [...expressionTests, ...integrationTests];
  const results = tests.map(([name, fn]) => runTest(name, fn));
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  // exitCode, not exit(1): stdout is async when it is a pipe, which is how
  // tests/run-all.js runs this, and process.exit() does not wait for pending
  // writes — it could drop the two lines above, which the aggregator totals.
  if (failed > 0) process.exitCode = 1;
}

main();
