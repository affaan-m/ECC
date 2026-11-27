/**
 * Tests for .kiro/install.sh
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const KIRO_ROOT = path.join(REPO_ROOT, '.kiro');
const INSTALL_SCRIPT = path.join(KIRO_ROOT, 'install.sh');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function runInstall(scriptPath, options = {}) {
  return execFileSync('bash', [scriptPath, ...(options.args || [])], {
    cwd: options.cwd,
    env: {
      ...process.env,
      HOME: options.homeDir || process.env.HOME,
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 300000,
  });
}

function listFiles(root) {
  const files = [];
  const walk = (dirPath) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, entryPath).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return files.sort();
}

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing Kiro install script ===\n');

  let passed = 0;
  let failed = 0;

  if (process.platform === 'win32') {
    console.log('  - skipped on Windows; Kiro shell scripts are Unix-only');
    console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
    process.exit(0);
  }

  if (test('copies nested skill resources, not only top-level skill files', () => {
    const homeDir = createTempDir('kiro-home-');
    const sourceRoot = createTempDir('kiro-source-');
    const projectRoot = createTempDir('kiro-project-');

    try {
      // install.sh installs from the directory it lives in, so a copy of the
      // script next to a synthetic skill tree keeps this independent of the
      // real skill contents.
      const skillDir = path.join(sourceRoot, 'skills', 'demo-skill');
      fs.mkdirSync(path.join(skillDir, 'examples'), { recursive: true });
      fs.mkdirSync(path.join(skillDir, 'references', 'deep'), { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Demo skill\n');
      fs.writeFileSync(path.join(skillDir, 'examples', 'sample.sql'), 'select 1;\n');
      fs.writeFileSync(path.join(skillDir, 'references', 'deep', 'notes.md'), 'deep notes\n');
      const scriptCopy = path.join(sourceRoot, 'install.sh');
      fs.copyFileSync(INSTALL_SCRIPT, scriptCopy);

      runInstall(scriptCopy, { cwd: homeDir, homeDir, args: [projectRoot] });

      const installedSkill = path.join(projectRoot, '.kiro', 'skills', 'demo-skill');
      assert.deepStrictEqual(listFiles(installedSkill), [
        'SKILL.md',
        'examples/sample.sql',
        'references/deep/notes.md',
      ]);
      assert.strictEqual(fs.readFileSync(path.join(installedSkill, 'examples', 'sample.sql'), 'utf8'), 'select 1;\n');
    } finally {
      cleanup(homeDir);
      cleanup(sourceRoot);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('installs every file of the bundled Kiro skills', () => {
    const homeDir = createTempDir('kiro-home-');
    const projectRoot = createTempDir('kiro-project-');

    try {
      runInstall(INSTALL_SCRIPT, { cwd: homeDir, homeDir, args: [projectRoot] });

      const installedSkills = path.join(projectRoot, '.kiro', 'skills');
      const missing = listFiles(path.join(KIRO_ROOT, 'skills'))
        .filter((relativePath) => !fs.existsSync(path.join(installedSkills, relativePath)));

      assert.deepStrictEqual(missing, [], `Skill files were not installed: ${missing.join(', ')}`);
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('reinstall leaves an existing skill directory untouched', () => {
    const homeDir = createTempDir('kiro-home-');
    const projectRoot = createTempDir('kiro-project-');

    try {
      runInstall(INSTALL_SCRIPT, { cwd: homeDir, homeDir, args: [projectRoot] });

      const customizedSkill = path.join(projectRoot, '.kiro', 'skills', 'tdd-workflow', 'SKILL.md');
      fs.writeFileSync(customizedSkill, 'user customized skill\n');

      runInstall(INSTALL_SCRIPT, { cwd: homeDir, homeDir, args: [projectRoot] });

      assert.strictEqual(fs.readFileSync(customizedSkill, 'utf8'), 'user customized skill\n');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
