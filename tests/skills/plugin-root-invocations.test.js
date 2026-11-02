/**
 * Skill script invocations must resolve the ECC root instead of assuming the
 * user's project directory contains ECC's scripts (#3530).
 *
 * The documented commands have to work in every install mode:
 *   - plugin install (CLAUDE_PLUGIN_ROOT set; the path may contain spaces)
 *   - standalone install (~/.claude or $CLAUDE_CONFIG_DIR)
 *   - explicitly authorized ECC checkout (CLAUDE_PLUGIN_ROOT set)
 * and when none of those resolves, the command must stop with an explicit
 * error instead of a misleading `Cannot find module` from a guessed path.
 *
 * The executed cases run the exact bash block published in tdd-workflow from an
 * unrelated project directory against a real copy of the ECC scripts.
 *
 * Run with: node tests/skills/plugin-root-invocations.test.js
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function skip(reason) {
  const error = new Error(reason);
  error.code = 'SKIP';
  throw error;
}

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed += 1;
  } catch (error) {
    if (error && error.code === 'SKIP') {
      process.stdout.write(`  SKIP ${name}: ${error.message}\n`);
      return;
    }
    process.stdout.write(`  FAIL ${name}: ${error.message}\n`);
    failed += 1;
  }
}

function readSkill(name) {
  return fs.readFileSync(path.join(repoRoot, 'skills', name, 'SKILL.md'), 'utf8');
}

function bashBlocks(markdown) {
  return [...markdown.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
}

function blockContaining(markdown, needle) {
  const block = bashBlocks(markdown).find((candidate) => candidate.includes(needle));
  assert.ok(block, `expected a bash block containing "${needle}"`);
  return block;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RESOLVER_SNIPPET =
  'ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}}"';

function assertResolvesScript(skillName, script) {
  const skill = readSkill(skillName);
  assert.ok(skill.includes(RESOLVER_SNIPPET),
    `${skillName} must use the configured plugin/checkout root or standalone install`);
  assert.ok(skill.includes(`[ -f "$ECC_ROOT/scripts/${script}" ] ||`),
    `${skillName} must refuse a missing helper in the selected trusted root`);
  assert.doesNotMatch(skill, /ECC_ROOT=["']?\$PWD/,
    `${skillName} must not derive executable trust from the working directory`);
  assert.doesNotMatch(skill, /\$PWD\/\.claude-plugin\/plugin\.json/,
    `${skillName} must not use forgeable project markers as executable authority`);
  assert.ok(skill.includes('export CLAUDE_PLUGIN_ROOT="/absolute/path/to/reviewed/ECC"'),
    `${skillName} must explain explicit checkout authorization`);
  assert.match(skill, new RegExp(`node "\\$ECC_ROOT/scripts/${escapeRegExp(script)}"`),
    `${skillName} must run the script from the resolved ECC root`);
  assert.doesNotMatch(skill, /\$\{CLAUDE_PLUGIN_ROOT:-\$PWD\}/,
    `${skillName} must not fall back to the user's project directory`);
  assert.doesNotMatch(skill, new RegExp(`^\\s*node scripts/${escapeRegExp(script)}`, 'm'),
    `${skillName} must not assume ECC scripts live in the current directory`);
}

// ---------------------------------------------------------------------------
// Static checks: the three skills document the resolving form.
// ---------------------------------------------------------------------------

process.stdout.write('\nSkill plugin-root script invocation tests:\n\n');

test('tdd-workflow resolves the package-manager detector through the ECC root', () => {
  assertResolvesScript('tdd-workflow', 'setup-package-manager.js');
});

test('autonomous-loops resolves claw.js through the ECC root', () => {
  assertResolvesScript('autonomous-loops', 'claw.js');
  const skill = readSkill('autonomous-loops');
  assert.match(skill,
    /CLAW_SESSION=my-project CLAW_SKILLS=tdd-workflow,security-review node "\$ECC_ROOT\/scripts\/claw\.js"/);
});

test('dmux-workflows resolves orchestrate-worktrees.js through the ECC root', () => {
  assertResolvesScript('dmux-workflows', 'orchestrate-worktrees.js');
});

test('seedPaths examples stay relative to the user repository', () => {
  const skill = readSkill('dmux-workflows');
  assert.match(skill, /"scripts\/orchestrate-worktrees\.js"/);
});

// ---------------------------------------------------------------------------
// Executed checks: run the documented command against a real plugin root.
// ---------------------------------------------------------------------------

function createFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-plugin-root-invocations-'));
  const pluginRoot = path.join(base, 'plugin root with spaces');
  const standaloneHome = path.join(base, 'home dir with spaces');
  const emptyHome = path.join(base, 'empty home');
  const userProject = path.join(base, 'user project');

  for (const scriptsParent of [pluginRoot, path.join(standaloneHome, '.claude')]) {
    fs.mkdirSync(scriptsParent, { recursive: true });
    fs.cpSync(path.join(repoRoot, 'scripts'), path.join(scriptsParent, 'scripts'), {
      recursive: true,
    });
  }
  fs.mkdirSync(emptyHome, { recursive: true });
  fs.mkdirSync(userProject, { recursive: true });
  fs.writeFileSync(
    path.join(userProject, 'package.json'),
    '{"name":"unrelated-project","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(userProject, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n');

  assert.ok(!fs.existsSync(path.join(userProject, 'scripts')),
    'fixture precondition: the user project must not contain ECC scripts');
  return { base, pluginRoot, standaloneHome, emptyHome, userProject };
}

const fixture = createFixture();

function runDetector({ pluginRoot, home, cwd, configRoot = '' }) {
  const block = blockContaining(
    readSkill('tdd-workflow'),
    'node "$ECC_ROOT/scripts/setup-package-manager.js" --detect');
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: configRoot };
  if (pluginRoot) {
    env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  } else {
    delete env.CLAUDE_PLUGIN_ROOT;
  }
  delete env.CLAUDE_PACKAGE_MANAGER;
  return spawnSync('bash', ['-c', block], { cwd, env, encoding: 'utf8', timeout: 60000 });
}

function assertDetectorRanInProject(result) {
  assert.strictEqual(result.error, undefined, `detector failed to start: ${result.error}`);
  assert.strictEqual(result.status, 0,
    `detector exited ${result.status}: ${result.stderr || result.stdout}`);
  assert.match(result.stdout, /Package Manager Detection/);
  // The detection output must come from the unrelated project directory (its
  // pnpm lockfile), proving the helper ran there rather than in an ECC checkout.
  assert.match(result.stdout, /From lock file: pnpm/);
  assert.doesNotMatch(result.stderr, /Cannot find module/);
}

test('documented detector command runs from an unrelated project through a plugin root with spaces', () => {
  if (process.platform === 'win32') skip('executed fixture requires a POSIX shell');
  const result = runDetector({
    pluginRoot: fixture.pluginRoot,
    home: fixture.emptyHome,
    cwd: fixture.userProject,
  });
  assertDetectorRanInProject(result);
});

test('documented detector command falls back to the standalone install when CLAUDE_PLUGIN_ROOT is unset', () => {
  if (process.platform === 'win32') skip('executed fixture requires a POSIX shell');
  const result = runDetector({
    pluginRoot: null,
    home: fixture.standaloneHome,
    cwd: fixture.userProject,
  });
  assertDetectorRanInProject(result);
});

test('documented detector command uses an explicitly authorized ECC checkout from the project directory', () => {
  if (process.platform === 'win32') skip('executed fixture requires a POSIX shell');
  const result = runDetector({
    pluginRoot: repoRoot,
    home: fixture.emptyHome,
    cwd: fixture.userProject,
  });
  assertDetectorRanInProject(result);
});

test('documented detector honors the configured standalone root with spaces', () => {
  if (process.platform === 'win32') skip('executed fixture requires a POSIX shell');
  assertDetectorRanInProject(runDetector({
    pluginRoot: null,
    home: fixture.emptyHome,
    configRoot: path.join(fixture.standaloneHome, '.claude'),
    cwd: fixture.userProject,
  }));
});

test('documented detector command fails loudly when no ECC root resolves', () => {
  if (process.platform === 'win32') skip('executed fixture requires a POSIX shell');
  const result = runDetector({
    pluginRoot: null,
    home: fixture.emptyHome,
    cwd: fixture.userProject,
  });
  assert.strictEqual(result.status, 1,
    `expected an explicit failure, got exit ${result.status}: ${result.stdout}`);
  assert.match(result.stderr, /ECC scripts not found/);
  assert.doesNotMatch(result.stderr, /Cannot find module/);
});

test('documented detector refuses a user-project lookalike script without an ECC checkout marker', () => {
  if (process.platform === 'win32') skip('executed fixture requires a POSIX shell');
  const marker = path.join(fixture.userProject, 'lookalike-ran');
  const script = path.join(fixture.userProject, 'scripts', 'setup-package-manager.js');
  fs.mkdirSync(path.dirname(script));
  fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n`);
  const result = runDetector({ pluginRoot: null, home: fixture.emptyHome, cwd: fixture.userProject });
  assert.strictEqual(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /ECC scripts not found/);
  assert.ok(!fs.existsSync(marker), 'the project lookalike helper must not execute');
});

for (const [skillName, script] of [
  ['tdd-workflow', 'setup-package-manager.js'],
  ['autonomous-loops', 'claw.js'],
  ['dmux-workflows', 'orchestrate-worktrees.js'],
]) {
  for (const explicitMissingRoot of [false, true]) {
    test(`${skillName} refuses both-marker project lookalikes${explicitMissingRoot ? ' even with an explicit missing root' : ''}`, () => {
      if (process.platform === 'win32') skip('executed fixture requires a POSIX shell');
      const cwd = fs.mkdtempSync(path.join(fixture.base, 'lookalike-project-'));
      const ran = path.join(cwd, 'untrusted-helper-ran');
      fs.mkdirSync(path.join(cwd, '.claude-plugin'));
      fs.mkdirSync(path.join(cwd, 'scripts'));
      fs.writeFileSync(path.join(cwd, '.claude-plugin', 'plugin.json'), '{"name":"ecc"}');
      fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"ecc-lookalike"}');
      fs.writeFileSync(path.join(cwd, 'scripts', script),
        `require('fs').writeFileSync(${JSON.stringify(ran)}, 'untrusted helper executed');\n`);
      const block = blockContaining(readSkill(skillName), `node "$ECC_ROOT/scripts/${script}"`);
      const env = { ...process.env, HOME: fixture.emptyHome, CLAUDE_CONFIG_DIR: '' };
      delete env.CLAUDE_PLUGIN_ROOT;
      if (explicitMissingRoot) env.CLAUDE_PLUGIN_ROOT = path.join(fixture.base, 'explicit missing ECC');
      const result = spawnSync('bash', ['-c', block], { cwd, env, encoding: 'utf8', timeout: 60000 });
      assert.strictEqual(result.error, undefined);
      assert.ok(!fs.existsSync(ran), 'both marker files caused untrusted project helper execution');
      assert.strictEqual(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, /ECC scripts not found/);
    });
  }
}

fs.rmSync(fixture.base, { recursive: true, force: true });

process.stdout.write(`\nResults: Passed: ${passed}, Failed: ${failed}\n`);
process.exitCode = failed ? 1 : 0;
